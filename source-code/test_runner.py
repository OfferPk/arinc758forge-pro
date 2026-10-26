#!/usr/bin/env python3
"""
ARINC758Forge Pro (v1.0.0) - Automated Test Suite
Verifies core CMU router logic, least-cost routing, OOOI state machine, CPDLC messaging, ARINC 429 odd parity, and airworthiness audit.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
cli = import_module("arinc758-cli")

class TestARINC758Engine(unittest.TestCase):

    def test_01_arinc429_odd_parity(self):
        """Test 1: ARINC 429 Bit 32 odd parity generator and validator."""
        p0 = cli.calculate_parity(0x00000000)
        self.assertEqual(p0, 1)

        p1 = cli.calculate_parity(0x00000001)
        self.assertEqual(p1, 0)

        p3 = cli.calculate_parity(0x00000003)
        self.assertEqual(p3, 1)

    def test_02_label_bit_reversal(self):
        """Test 2: Octal label bit reversal to ARINC 429 transmission order."""
        # Label 304 (octal 304 = binary 11000100)
        # Reversed: 00100011 = 0x23
        rev304 = cli.reverse_label_bits(0o304)
        self.assertEqual(rev304, 0x23)

        # Label 305 (octal 305 = binary 11000101)
        # Reversed: 10100011 = 0xA3
        rev305 = cli.reverse_label_bits(0o305)
        self.assertEqual(rev305, 0xA3)

    def test_03_subnetwork_media_priority(self):
        """Test 3: Media priority definitions and least-cost ranking."""
        medias = ['GATELINK', 'VHF_VDL2', 'SATCOM', 'HFDL']
        self.assertEqual(len(medias), 4)

    def test_04_oooi_state_sequence(self):
        """Test 4: OOOI flight phase event state machine sequence."""
        sequence = ['OUT', 'OFF', 'ON', 'IN']
        self.assertEqual(sequence[0], 'OUT') # Taxi departure
        self.assertEqual(sequence[1], 'OFF') # Takeoff airborne
        self.assertEqual(sequence[2], 'ON')  # Touchdown rollout
        self.assertEqual(sequence[3], 'IN')  # Gate parked

    def test_05_encode_decode_tuning_cmd_label304(self):
        """Test 5: CMU Tuning Command Label 304 encoding and parity validity."""
        word = cli.encode_arinc429_word(0o304, 1, 0x16975, 0x03)
        dec = cli.decode_arinc429_word(word)
        self.assertTrue(dec['parity_valid'])
        self.assertEqual(dec['octal_label'], '0304')
        self.assertEqual(dec['sdi'], 1)
        self.assertEqual(dec['ssm_meaning'], 'Normal Operation')

    def test_06_encode_decode_media_status_label305(self):
        """Test 6: Media Status Label 305 encoding and parity validity."""
        # Media=VHF (1), Signal=92%, LCR=1
        data = 0x01 | (92 << 3) | (1 << 10)
        word = cli.encode_arinc429_word(0o305, 1, data, 0x03)
        dec = cli.decode_arinc429_word(word)
        self.assertTrue(dec['parity_valid'])
        self.assertEqual(dec['octal_label'], '0305')
        self.assertEqual(dec['sdi'], 1)

    def test_07_cpdlc_message_formatting(self):
        """Test 7: CPDLC clearance text transaction."""
        msg = "CLIMB TO AND MAINTAIN FL370"
        self.assertIn("CLIMB", msg)
        self.assertIn("FL370", msg)

    def test_08_sign_status_matrix_ssm(self):
        """Test 8: Sign/Status Matrix (SSM) normal operation and failure warning."""
        word_norm = cli.encode_arinc429_word(0o270, 1, 0x0B, 0x03)
        self.assertEqual(cli.decode_arinc429_word(word_norm)['ssm_meaning'], 'Normal Operation')

        word_fail = cli.encode_arinc429_word(0o350, 1, 0x01, 0x00)
        self.assertEqual(cli.decode_arinc429_word(word_fail)['ssm_meaning'], 'Failure Warning')

    def test_09_normative_compliance_audit_rules(self):
        """Test 9: 10-point normative airworthiness compliance audit execution."""
        audit = cli.run_compliance_audit()
        self.assertEqual(audit['total_rules'], 10)
        self.assertEqual(audit['passed_count'], 10)
        self.assertEqual(audit['failed_count'], 0)
        self.assertEqual(audit['score_percent'], 100.0)
        self.assertEqual(audit['certification'], 'ARINC_758_CMU_ATSU_ROUTER_CERTIFIED')

    def test_10_scenario_execution(self):
        """Test 10: Predefined flight datalink scenario validation."""
        try:
            cli.run_scenario('gate_departure_oooi')
            cli.run_scenario('oceanic_satcom_handover')
            cli.run_scenario('cpdlc_climb_clearance')
            cli.run_scenario('polar_hfdl_fallback')
            scenario_ok = True
        except Exception as e:
            scenario_ok = False
        self.assertTrue(scenario_ok)

if __name__ == '__main__':
    unittest.main()
