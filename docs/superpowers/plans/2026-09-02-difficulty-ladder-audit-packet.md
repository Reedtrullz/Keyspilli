# Small symbolic ladder audit packet

This packet is the bounded follow-up for decision E. It contains no audio and
does not ask for a listening judgment by itself. Each case shows a harder →
easier edge, the measured identity/complexity summary, and one or two omitted
RH notes with their local harder-level context. Values are diagnostic only;
the source fixtures are project-owned and remain the only inputs.

| Fixture / edge | Class | Identity (onset / PC / turns) | Note reduction | Omitted RH sample(s) and harder context |
| --- | --- | --- | ---: | --- |
| classical Advanced → Medium | HEALTHY_SIMPLIFICATION | 0.998 / 0.998 / 0.992 | 0.020 | 72@68; context 73@67, 82@67, 85@67, 73@67.5, 82@67.5, 85@67.5, 72@68, 78@68 |
| classical Easy → Very Easy | REDUNDANT_LEVEL | 0.991 / 0.991 / 0.865 | 0.000 | No omitted RH sample in the paired onset pass |
| classical Very Easy → Beginner | INCONCLUSIVE | 0.991 / 0.991 / 0.865 | 0.548 | No first omitted RH sample under the pairing tolerance; inspect LH/role loss |
| classical Beginner → Very Beginner | IDENTITY_CLIFF | 0.838 / 0.838 / 0.469 | 0.154 | 66@93.75 (context 82@93, 66@93.75); 56@119.25 (61@118.25, 56@119.25, 60@119.5, 68@120) |
| cover Easy → Very Easy | NON_MONOTONIC | 0.969 / 0.969 / 0.772 | 0.010 | 64@186.625 (64@185.625, 64@186.625, 69@186.75, 73@187.625); 69@218.625 (74@217.625, 69@218.25, 69@218.625, 73@218.75) |
| cover Very Easy → Beginner | INCONCLUSIVE | 0.474 / 0.474 / 0.137 | 0.686 | 80@4.625 (context 80@4.625, 81@5.625); 81@5.625 (80@4.625, 81@5.625, 80@6.625) |
| cover Beginner → Very Beginner | IDENTITY_CLIFF | 0.439 / 0.439 / 0.128 | 0.073 | 64@55.25; 69@109.5 (69@109.5, 69@110, 83@110.5) |
| pop Advanced → Medium | REDUNDANT_LEVEL | 1 / 1 / 1 | 0.005 | 65@212 (77@211.5, 65@212, 68@212, 72@212, 77@212, 77@212.5, 80@213); 65@220 (same shape at 219.5–221) |
| pop Easy → Very Easy | REDUNDANT_LEVEL | 0.997 / 0.997 / 0.927 | 0.000 | No omitted RH sample in the paired onset pass |
| pop Very Easy → Beginner | INCONCLUSIVE | 0.997 / 0.997 / 0.927 | 0.557 | No first omitted RH sample under the pairing tolerance; inspect LH/role loss |
| pop Beginner → Very Beginner | IDENTITY_CLIFF | 0.870 / 0.870 / 0.490 | 0.128 | 63@79.75 (63@79.5, 63@79.75, 63@80); 70@105 (63@104, 71@104.75, 70@105, 68@105.5) |

The packet is intentionally symbolic and capped at 11 cases. It does not
pretend that a missing note is wrong, that a large leap is illegitimate, or
that onset agreement proves pitch correctness. Human raters, if later used,
should receive the harder/easier render for only the cases they choose after
this diagnostic review. The four-onset synthetic full-band shadow is retained
in the machine-readable baseline for regression coverage but is omitted from
this human-facing packet because it is too small to judge identity.
