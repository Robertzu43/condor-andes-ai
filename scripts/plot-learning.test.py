"""Exercise the authoring script's probability filter without changing real evidence."""
import copy
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('plot-learning.py')


class ProbabilityEvidenceTest(unittest.TestCase):
    def test_only_complete_applied_distributions_become_points(self):
        template = json.loads((SCRIPT.parent.parent / 'docs/results/2026-10-12-experiment.json').read_text())['records'][0]
        def decision(probabilities, **changes):
            return dict(type='decision', outcome='applied', action='flap', probabilities=probabilities, **changes)
        good = [{'choice': 'flap', 'probability': .7}, {'choice': 'wait', 'probability': .3}]
        events = [decision(good), {**decision(good), 'action': 'wait'},
                  decision([{'choice': 'wait', 'probability': .295}, good[0]])]
        malformed = [None, {}, [], [good[0]], good + [good[0]], [good[0], good[0]],
                     [good[0], None], [good[0], {'choice': 'other', 'probability': .3}]]
        for value in [True, '0.3', None, float('nan'), float('inf'), -.1, 1.1, .1]:
            malformed.append([good[0], {'choice': 'wait', 'probability': value}])
        events += [decision(value) for value in malformed]
        events += [None, [], {**decision(good), 'action': 'other'},
                   {**decision(good), 'outcome': 'rejected'}, {**decision(good), 'type': 'request'}]
        rows = []
        for index, event in enumerate(events):
            row = copy.deepcopy(template)
            row.update(episodeId=str(index), events=[event])
            rows.append(row)
        previous_args = sys.argv
        try:
            with tempfile.TemporaryDirectory() as directory:
                source, output = Path(directory) / 'input.json', Path(directory) / 'figure.svg'
                source.write_text(json.dumps({'records': rows}))
                sys.argv = [str(SCRIPT), str(source), str(output)]
                result = runpy.run_path(str(SCRIPT))
                self.assertEqual([point[0] for point in result['points']], [.7, .3, .7])
                self.assertTrue(output.is_file())
                result['plt'].close(result['fig'])
        finally:
            sys.argv = previous_args


if __name__ == '__main__':
    unittest.main()
