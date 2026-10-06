"""Offline boundary tests; no closed study or source-performance claims."""
import hashlib,json,sys
from pathlib import Path
import unittest
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import player_input_evidence as player


class PlayerInputEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='keyspilli-player-test-')
        self.addCleanup(self.scratch.cleanup)
        self.tmp_path = Path(self.scratch.name)

    def test_expected_notes_never_enter_fit(self):
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(ValueError, 'request keys'):
            player.analyze_player_input({'captureManifestPath':str(tmp_path/'absent'),'referenceManifestPath':str(tmp_path/'bank'),'dictionaryDir':str(tmp_path/'cache'),'expectedNotes':[60]})


    def test_output_exists_refuses_before_input_access(self):
        tmp_path = self.tmp_path
        with self.assertRaises(FileExistsError):player.write_player_input_evidence({},tmp_path)


    def test_refuses_compressed_or_inferred_input_before_bank_access(self):
        tmp_path = self.tmp_path
        manifest={'schemaVersion':1,'kind':'keyspilli-player-paired-capture','input':{'encoding':'pcm-s16le'}}
        path=tmp_path/'capture.json';path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'input domain'):
            player.analyze_player_input({'captureManifestPath':str(path),'referenceManifestPath':str(tmp_path/'never-read'),'dictionaryDir':str(tmp_path/'never-read-cache')})


    def test_weak_activation_withholds_pitch_set(self):
        tmp_path = self.tmp_path
        assert player.accept_history({'pitches':[60],'events':[{'amplitude':.1},{'amplitude':.01}],'rawResidual':.001}) is None
        assert player.accept_history({'pitches':[60],'events':[{'amplitude':.1}],'rawResidual':.01}) == [60]
        assert player.accept_history({'pitches':[60],'events':[{'amplitude':.1}],'rawResidual':.06}) is None


    def test_low_level_refuses_without_absence_claim(self):
        tmp_path = self.tmp_path
        assert player.accept_history({'pitches':None,'reason':'below-level','rmsDbfs':-60}) is None


    def test_reference_hash_or_cache_identity_drift_refuses(self):
        tmp_path = self.tmp_path
        (tmp_path/'identity.json').write_text(json.dumps({'identity':'other','files':[]}))
        with self.assertRaisesRegex(ValueError, 'stale'):
            player.validate_dictionary(tmp_path,{'identity':'required'})


    def test_partial_cache_and_interrupted_build_refuse(self):
        tmp_path = self.tmp_path
        with self.assertRaisesRegex(ValueError, 'partial'):
            player.validate_dictionary(tmp_path,{'identity':'required'})

    def test_float32_audio_param_identity_is_exact_not_tolerance(self):
        expected={'threshold':-24,'knee':12,'ratio':3,'attack':.005,'release':.15}
        actual=dict(expected,attack=.004999999888241291,release=.15000000596046448)
        self.assertEqual(player.profile_identity(actual),player.profile_identity(expected))
        self.assertNotEqual(player.profile_identity(dict(actual,ratio=4)),player.profile_identity(expected))
