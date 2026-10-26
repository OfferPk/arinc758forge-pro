/**
 * ARINC758Forge Pro (v1.0.0) - Core Communications Management Unit (CMU) Engine
 * Communications Management Unit / ATSU & Least-Cost Router (ARINC Characteristic 758 & ARINC 618/620)
 * 
 * Normative References:
 * - ARINC Characteristic 758 / 758A (Communications Management Unit - CMU Mark 2)
 * - ARINC Specification 618 (Air-Ground ACARS Communications Protocol)
 * - ARINC Specification 620 (Ground-Ground ACARS Message Formats)
 * - RTCA DO-258A / EUROCAE ED-100A (Interoperability Requirements for ATS Applications using ARINC 622 Data Communications)
 * - RTCA DO-280B / EUROCAE ED-110B (ATN Baseline 1 CPDLC / ADS-C Operations)
 * - ARINC Characteristic 739A (Multi-Purpose Control and Display Unit - MCDU)
 * - ARINC Specification 429 (Mark 33 Digital Information Transfer System)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ARINC758Engine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ARINC429_LABELS = {
    CMU_TUNING_CMD: 0o304,    // Label 304 - CMU to Subnetwork Tuning Command Word
    MEDIA_STATUS: 0o305,      // Label 305 - Subnetwork Link Selection & Media Status
    CMU_STATUS: 0o270,        // Label 270 - CMU Discrete Equipment Status & Router State
    CMU_FAULT: 0o350          // Label 350 - Maintenance & Fault BITE Word
  };

  const MEDIA_TYPES = {
    GATELINK: 'GATELINK (Airport Wireless LAN / Cellular 802.11 - Free)',
    VHF_VDL2: 'VHF_VDL2 (VDL Mode 2 / POA - En-Route Low Cost)',
    SATCOM: 'SATCOM (Inmarsat / Iridium Aero - Oceanic High Reliability)',
    HFDL: 'HFDL (High Frequency Datalink - Polar/Oceanic Backup)'
  };

  const OOOI_STATES = {
    IN: 'IN (Gate Parked / Doors Open / Flight Closed)',
    OUT: 'OUT (Taxi Departure / Doors Closed / Brake Released)',
    OFF: 'OFF (Airborne / Gear Strut Extended / En-Route)',
    ON: 'ON (Touchdown / Weight-on-Wheels / Landing Rollout)'
  };

  /**
   * Helper: Calculate ARINC 429 Bit 32 Odd Parity
   */
  function calculateParity(word31Bits) {
    let count = 0;
    for (let i = 0; i < 31; i++) {
      if ((word31Bits >>> i) & 1) {
        count++;
      }
    }
    return (count % 2 === 0) ? 1 : 0;
  }

  /**
   * Helper: Reverse 8-bit octal label to ARINC 429 transmission order
   */
  function reverseLabelBits(octalLabel) {
    let reversed = 0;
    for (let i = 0; i < 8; i++) {
      reversed = (reversed << 1) | ((octalLabel >> i) & 1);
    }
    return reversed;
  }

  /**
   * Helper: Encode a full ARINC 429 32-bit word with Bit 32 Odd Parity
   */
  function encodeARINC429Word(octalLabel, sdi, dataBits, ssm) {
    const revLabel = reverseLabelBits(octalLabel) & 0xFF;
    const sdiField = (sdi & 0x03) << 8;
    const dataField = (dataBits & 0x7FFFF) << 10;
    const ssmField = (ssm & 0x03) << 29;

    let word = revLabel | sdiField | dataField | ssmField;
    const parity = calculateParity(word);
    word |= (parity << 31);
    return word >>> 0;
  }

  /**
   * Helper: Decode an ARINC 429 32-bit word
   */
  function decodeARINC429Word(word32) {
    const parity = (word32 >>> 31) & 1;
    const wordWithoutParity = word32 & 0x7FFFFFFF;
    const expectedParity = calculateParity(wordWithoutParity);
    const parityValid = (parity === expectedParity);

    const ssm = (word32 >>> 29) & 0x03;
    const data = (word32 >>> 10) & 0x7FFFF;
    const sdi = (word32 >>> 8) & 0x03;
    const rawLabel = word32 & 0xFF;

    let octalLabel = 0;
    for (let i = 0; i < 8; i++) {
      octalLabel = (octalLabel << 1) | ((rawLabel >> i) & 1);
    }

    const ssmMeaning = (ssm === 0x03) ? 'Normal Operation' :
                       (ssm === 0x00) ? 'Failure Warning' :
                       (ssm === 0x01) ? 'No Computed Data (NCD)' : 'Functional Test';

    return {
      wordHex: '0x' + word32.toString(16).toUpperCase().padStart(8, '0'),
      octalLabel: '0' + octalLabel.toString(8).padStart(3, '0'),
      sdi,
      data,
      ssm,
      ssmMeaning,
      parityValid
    };
  }

  /**
   * ARINC 758 Communications Management Unit (CMU) LRU Class
   */
  class ARINC758CMU {
    constructor(config = {}) {
      this.unitId = config.unitId || 1; // 1 = CMU 1 / ATSU (Left), 2 = CMU 2 (Right)
      this.aircraftTail = config.aircraftTail || 'A6-EGO'; // Emirates Boeing 777-300ER
      this.flightNumber = config.flightNumber || 'UAE123';
      this.originAirport = config.originAirport || 'OMDB'; // Dubai Int'l
      this.destAirport = config.destAirport || 'EGLL'; // London Heathrow
      this.currentMedia = config.currentMedia || MEDIA_TYPES.VHF_VDL2;
      this.oooiState = config.oooiState || OOOI_STATES.OFF;
      this.acarsConnected = true;
      this.cpdlcConnected = true;
      this.adsCConnected = true;
      this.currentAtcCenter = config.currentAtcCenter || 'EGGX (Shanwick Oceanic)';
      this.assignedAltitudeFl = config.assignedAltitudeFl || 370;

      // Least-Cost Routing (LCR) Subnetwork Health Matrix
      this.subnetworks = {
        gatelink: { available: false, signalPercent: 0, costPerMb: 0.00, latencyMs: 30 },
        vhf_vdl2: { available: true,  signalPercent: 92, costPerMb: 1.50, latencyMs: 450 },
        satcom:   { available: true,  signalPercent: 88, costPerMb: 12.00, latencyMs: 1200 },
        hfdl:     { available: true,  signalPercent: 74, costPerMb: 4.50, latencyMs: 2500 }
      };

      // Message Traffic Log
      this.messagesLog = [
        { id: 1, type: 'OOOI_OUT', time: '10:15Z', media: 'GATELINK', payload: 'OOOI OUT OMDB GATE B14 FUEL 65400KG' },
        { id: 2, type: 'OOOI_OFF', time: '10:32Z', media: 'VHF_VDL2', payload: 'OOOI OFF OMDB RWY 30R TOW 248000KG' },
        { id: 3, type: 'CPDLC_UPLINK', time: '11:15Z', media: 'VHF_VDL2', payload: 'CLIMB TO AND MAINTAIN FL370' },
        { id: 4, type: 'CPDLC_DOWNLINK', time: '11:16Z', media: 'VHF_VDL2', payload: 'WILCO CLIMB FL370 / ROVAK 11:42Z' }
      ];

      this.evaluateLeastCostRouting();
    }

    setOOOI(state) {
      if (!Object.values(OOOI_STATES).includes(state)) {
        throw new Error(`Invalid OOOI state: ${state}`);
      }
      this.oooiState = state;
      const timeStr = new Date().toISOString().substring(11, 16) + 'Z';
      const oooiMsg = `OOOI ${state.slice(0,3)} ${this.flightNumber} ${this.aircraftTail} STATE CONFIRMED`;
      
      this.messagesLog.push({
        id: this.messagesLog.length + 1,
        type: `OOOI_${state.slice(0,3)}`,
        time: timeStr,
        media: this.currentMedia.split(' ')[0],
        payload: oooiMsg
      });

      this.evaluateLeastCostRouting();
      return this.oooiState;
    }

    /**
     * Automatic Multi-Subnetwork Dynamic Least-Cost Routing Engine
     */
    evaluateLeastCostRouting() {
      // Logic:
      // 1. If at Gate (IN state), prefer Gatelink (Cellular/Airport WiFi) if available
      // 2. If Airborne (OFF) and VHF VDL2 available, use VHF (lowest en-route cost)
      // 3. If Oceanic/Remote (VHF lost), seamlessly handover to SATCOM
      // 4. If Polar / Satcom degraded, use HFDL
      if (this.oooiState === OOOI_STATES.IN && this.subnetworks.gatelink.available) {
        this.currentMedia = MEDIA_TYPES.GATELINK;
      } else if (this.subnetworks.vhf_vdl2.available && this.subnetworks.vhf_vdl2.signalPercent > 30) {
        this.currentMedia = MEDIA_TYPES.VHF_VDL2;
      } else if (this.subnetworks.satcom.available) {
        this.currentMedia = MEDIA_TYPES.SATCOM;
      } else if (this.subnetworks.hfdl.available) {
        this.currentMedia = MEDIA_TYPES.HFDL;
      } else {
        this.currentMedia = 'NO_LINK_AVAILABLE';
      }
      return this.currentMedia;
    }

    sendCPDLCMessage(msgText, isWilco = false) {
      const timeStr = new Date().toISOString().substring(11, 16) + 'Z';
      const entry = {
        id: this.messagesLog.length + 1,
        type: isWilco ? 'CPDLC_WILCO' : 'CPDLC_DOWNLINK',
        time: timeStr,
        media: this.currentMedia.split(' ')[0],
        payload: msgText
      };
      this.messagesLog.push(entry);
      return entry;
    }

    /**
     * Generate ARINC 739 MCDU Datalink Page Buffer (14 lines x 24 chars)
     */
    renderMCDUPage() {
      const mediaShort = this.currentMedia.split(' ')[0];
      const oooiShort = this.oooiState.slice(0, 3);
      const lines = [
        "   --- DATALINK COMM ---",
        `FLIGHT: ${this.flightNumber.padEnd(8)} TAIL:${this.aircraftTail}`,
        "ROUTE: OMDB -> EGLL    ",
        `LINK : ${mediaShort.padEnd(8)} OOOI:${oooiShort}`,
        "ATC  : " + this.currentAtcCenter.padEnd(16).slice(0, 16),
        "------------------------",
        "<ATC CPDLC MENU        >",
        "<COMPANY ACARS MSG     >",
        "<FLIGHT PLAN WINDS     >",
        "<TAKEOFF PERF DATA     >",
        "<SUB-NETWORK STATUS    >",
        "<WEATHER & NOTAMS      >",
        "------------------------",
        `STATUS: CONNECTED (LCR) `
      ];
      return lines;
    }

    /**
     * Encode ARINC 429 Label 304 (CMU to Subnetwork Tuning Command Word)
     */
    encodeLabel304() {
      // Commands VHF 3 (136.975 MHz), SATCOM, or HFDL channels
      const dataField = 0x16975; // 136.975 MHz default VDL2 frequency
      const sdi = (this.unitId === 2) ? 2 : 1;
      const ssm = 0x03; // Normal Operation
      return encodeARINC429Word(ARINC429_LABELS.CMU_TUNING_CMD, sdi, dataField, ssm);
    }

    /**
     * Encode ARINC 429 Label 305 (Subnetwork Link Selection & Media Status)
     */
    encodeLabel305() {
      // Bit 11-13: Active Media Code (0=Gatelink, 1=VHF, 2=SATCOM, 3=HFDL)
      let mediaCode = 1;
      if (this.currentMedia.startsWith('GATELINK')) mediaCode = 0;
      else if (this.currentMedia.startsWith('VHF')) mediaCode = 1;
      else if (this.currentMedia.startsWith('SATCOM')) mediaCode = 2;
      else if (this.currentMedia.startsWith('HFDL')) mediaCode = 3;

      // Bit 14-20: Signal Quality (0-100%)
      const sigQuality = this.subnetworks.vhf_vdl2.signalPercent & 0x7F;
      // Bit 21: Least-Cost Router Auto Enabled
      const lcrBit = 1;

      const dataField = (mediaCode) | (sigQuality << 3) | (lcrBit << 10);
      const sdi = (this.unitId === 2) ? 2 : 1;
      const ssm = 0x03;
      return encodeARINC429Word(ARINC429_LABELS.MEDIA_STATUS, sdi, dataField, ssm);
    }

    /**
     * Encode ARINC 429 Label 270 (CMU Discrete Equipment Status Word)
     */
    encodeLabel270() {
      let statusBits = 0;
      if (this.acarsConnected) statusBits |= (1 << 0);
      if (this.cpdlcConnected) statusBits |= (1 << 1);
      if (this.adsCConnected) statusBits |= (1 << 2);
      if (this.oooiState === OOOI_STATES.OFF) statusBits |= (1 << 3); // Airborne bit
      if (this.oooiState === OOOI_STATES.OUT) statusBits |= (1 << 4); // Taxiing bit
      if (this.oooiState === OOOI_STATES.IN) statusBits |= (1 << 5);  // Gate Parked

      const sdi = (this.unitId === 2) ? 2 : 1;
      const ssm = 0x03;
      return encodeARINC429Word(ARINC429_LABELS.CMU_STATUS, sdi, statusBits, ssm);
    }

    /**
     * Encode ARINC 429 Label 350 (CMU Maintenance / Fault Word)
     */
    encodeLabel350() {
      const faultBits = 0x00; // Normal healthy hardware
      const sdi = (this.unitId === 2) ? 2 : 1;
      const ssm = 0x03;
      return encodeARINC429Word(ARINC429_LABELS.CMU_FAULT, sdi, faultBits, ssm);
    }

    getTelemetrySnapshot() {
      this.evaluateLeastCostRouting();
      const l304 = this.encodeLabel304();
      const l305 = this.encodeLabel305();
      const l270 = this.encodeLabel270();
      const l350 = this.encodeLabel350();

      return {
        timestamp: new Date().toISOString(),
        unitId: `CMU ${this.unitId} (${this.unitId === 1 ? 'Left / ATSU Primary' : 'Right Standby'})`,
        aircraftTail: this.aircraftTail,
        flightNumber: this.flightNumber,
        route: `${this.originAirport} -> ${this.destAirport}`,
        oooiState: this.oooiState,
        currentMedia: this.currentMedia,
        currentAtcCenter: this.currentAtcCenter,
        assignedAltitudeFl: `FL${this.assignedAltitudeFl}`,
        datalinkProtocols: {
          acars: this.acarsConnected ? 'ONLINE (ARINC 618/620)' : 'OFFLINE',
          cpdlc: this.cpdlcConnected ? 'CONNECTED (ATN B1 / FANS 1/A)' : 'OFFLINE',
          adsC: this.adsCConnected ? 'REPORTING (15 min interval)' : 'OFFLINE'
        },
        subnetworks: this.subnetworks,
        recentMessages: this.messagesLog.slice(-5),
        mcduPageBuffer: this.renderMCDUPage(),
        arinc429Words: {
          label304_TuningCmd: decodeARINC429Word(l304),
          label305_MediaStatus: decodeARINC429Word(l305),
          label270_CMUStatus: decodeARINC429Word(l270),
          label350_Maintenance: decodeARINC429Word(l350)
        }
      };
    }
  }

  return {
    ARINC758CMU,
    ARINC429_LABELS,
    MEDIA_TYPES,
    OOOI_STATES,
    calculateParity,
    reverseLabelBits,
    encodeARINC429Word,
    decodeARINC429Word
  };
}));
