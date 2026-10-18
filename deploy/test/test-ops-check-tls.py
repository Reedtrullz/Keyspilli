#!/usr/bin/env python3
"""The certificate-expiry probe must verify the peer and refuse TLS older than 1.2."""
import importlib.util
import ssl
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("ops", Path(__file__).parents[1] / "keyspilli-ops-check.py")
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class OpsCheckTls(unittest.TestCase):
    def test_context_requires_tls12_and_verifies_the_peer(self):
        context = ops.tls_context()
        self.assertIsInstance(context, ssl.SSLContext)
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_expiry_probe_uses_the_hardened_context(self):
        context = MagicMock()
        wrapped = context.wrap_socket.return_value.__enter__.return_value
        wrapped.getpeercert.return_value = {"notAfter": "Jan  1 00:00:00 2099 GMT"}
        with patch.object(ops, "tls_context", return_value=context) as factory, \
                patch.object(ops.socket, "create_connection", return_value=MagicMock()) as connect:
            days = ops.tls_days("keyspilli.example")
        factory.assert_called_once_with()
        connect.assert_called_once_with(("keyspilli.example", 443), timeout=10)
        self.assertEqual(context.wrap_socket.call_args.kwargs, {"server_hostname": "keyspilli.example"})
        self.assertGreater(days, 0)


if __name__ == "__main__":
    unittest.main()
