---
title: "The engagement viewer: single cases behind the G2 numbers"
date: 2026-10-17
---

The gates judged the models on medians over thousands of scenarios. The new
[engagement viewer](/viewer) shows one scenario at a time: the plan, both platforms' course and
speed, the bearings, and each gate's carried models beside the classical solver and the naive
baseline. It is the first step of SRD Annex A. Its first use is the owner's realism check of the
generator, which comes before any change to the training data.

<!-- truncate -->

## What it does

- **Regenerates scenarios in the browser** from their seed with the pipeline's own generator. No
  scenario files ship. A test checks the browser path is byte-identical to Node.
- **Runs the models in the browser** with tfjs on the CPU backend. The same encoding and decoding
  the pipeline uses feed it, and a test finds it within float32 tolerance of `tfjs-node`.
- **Three modes.** Truth shows the engagement. Instantaneous shows the causal LSTM's estimate at
  a "now" cursor, from the bearings up to then. Time-late shows the bidirectional LSTM's estimate
  at every sample of the window.
- **Every gate's carried pair**: iteration 1 (G1 pass) and iterations 2, 2b and 2c (G2 fail).
- **The URL holds the view**, so every link below reopens exactly what is described.

The 2c BiLSTM runs in about 1 s for one scenario in headless Chromium; the LSTM in about 0.5 s.
The eight models total 4.5 MB.

How it works: [the viewer](/docs/algorithms/viewer).

## A typical engagement

[Seed 203, scenario 97612, instantaneous, zig + 10 min](/viewer?src=s203-test&i=97612&mode=instantaneous&t=1690&pair=i2c).
The 2c LSTM sits near its own median errors here.

![The typical engagement in instantaneous mode](/img/blog/viewer-typical.jpg)

| At zig + 10 min | Range error | Course error | Speed error |
| --------------- | ----------- | ------------ | ----------- |
| 2c LSTM         | 11%         | 6°           | 1.6 kt      |
| Classical       | 3%          | 0°           | 0.9 kt      |
| Naive           | 41%         | 51°          | 6.6 kt      |

Before the zig the model still answers, but range is unobservable from bearings alone. The viewer
greys that period out. Here the LSTM's range sits well short of the truth before the zig and
reaches it only after the turn.

[The same scenario in time-late mode](/viewer?src=s203-test&i=97612&mode=time-late&t=1690&pair=i2c)
shows something the medians hide. The BiLSTM's estimated positions form a jagged path rather than
a straight track. Each sample's estimate comes from its own output row, and nothing ties them to
one constant-velocity solution. The classical batch solution is one straight track by
construction. In this case the BiLSTM's post-zig median speed error, 3.0 kt, is worse than the
instantaneous LSTM's 1.8 kt.

![The typical engagement in time-late mode](/img/blog/viewer-typical-tl.jpg)

## The largest speed error

[Seed 203, scenario 95484, instantaneous, zig + 10 min](/viewer?src=s203-test&i=95484&mode=instantaneous&t=1980&pair=i2c)
has the 2c LSTM's largest speed error at zig + 10 min among the σ = 1° scenarios: 10.9 kt.

![The largest speed error](/img/blog/viewer-worst.jpg)

The geometry is hard, not broken. The target starts 2.5 km away and opens at 17.3 kt on a course
within about 10° of the line of sight. The bearing barely moves, so speed along the line of sight
is weakly observable. The LSTM answers 6.5 kt, pulled towards typical training speeds. The
classical solver struggles too: 13 of its 101 post-zig solutions fail to converge, and its
median speed error is 6.5 kt. One case cannot say how often this happens; it shows one way the
models fail.

## A held-out engagement beyond the training ranges

[Seed 201 held-out, scenario 102983, time-late, zig + 5 min](/viewer?src=s201-heldout&i=102983&mode=time-late&t=1300&pair=i2c)
starts at 25.8 km. Training ranges ran from 2 to 20 km. The BiLSTM's range estimate starts near
18 km against a true 25 km: in this case the model does not reach ranges beyond those it was
trained on. The classical solver has no such limit.

![The held-out engagement in time-late mode](/img/blog/viewer-far.jpg)

| Post-zig medians | Range error | Course error | Speed error |
| ---------------- | ----------- | ------------ | ----------- |
| 2c BiLSTM        | 31%         | 34°          | 6.3 kt      |
| Classical        | 12%         | 3.5°         | 0.85 kt     |
| Naive            | 55%         | 53°          | 7.7 kt      |

## What comes next

The owner now runs the realism check in Annex A §A.5: do the tracks, turns, speeds and bearing
noise look like real engagements? Its record (§A.7) decides which Part B levers, such as larger
or more ownship course changes, are worth pre-registering on fresh seeds from 204 onward. Nothing
is trained until then.

These three cases illustrate; they do not measure. Frequencies come from the gate experiments,
not from cases picked in a viewer.
