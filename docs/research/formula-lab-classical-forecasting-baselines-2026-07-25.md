# Formula Lab classical forecasting baselines

Date: 2026-07-25  
Status: research input; no formula, strategy, or execution admission

## Source

- [Findings Comparing Classical and Machine Learning Methods for Time Series Forecasting](https://machinelearningmastery.com/findings-comparing-classical-and-machine-learning-methods-for-time-series-forecasting/)
- [Makridakis et al., “Statistical and Machine Learning forecasting methods: Concerns and ways forward”](https://doi.org/10.1371/journal.pone.0194889)

## Useful implication for Formula Lab

The reviewed study compared eight statistical methods and ten machine-learning methods across
1,045 monthly, univariate M3 series. On that population, classical ETS/ARIMA methods were stronger
for one-step forecasts, while Theta, ARIMA, and combined exponential-smoothing methods were
stronger for multi-step forecasts. The practical lesson for Alchemy is methodological: every
machine-learning experiment should have cheap, reproducible classical baselines and must justify
its additional compute and complexity on untouched chronological data.

Formula Lab should therefore add a baseline family containing at least:

- naive/random-walk and seasonal-naive controls;
- exponential smoothing / Holt / damped Holt;
- Theta;
- automatic ARIMA where the data volume and runtime budget permit it;
- a simple linear or rolling-mean control aligned to the same target and horizon.

All models must use the identical causal source cut, train/test boundaries, purging rule, target,
cost model, and evaluation metric. A model wins only by improving held-out economic results, not by
fitting the training series more closely.

## Limitation

The study population is monthly, univariate, and largely non-financial. It does not establish that
classical methods will beat tree models or neural networks on multivariate, high-frequency crypto
data with irregular microstructure. It supports baseline discipline, not a predetermined model
choice. High-frequency Formula Lab experiments must be assessed separately with walk-forward
folds, realistic fees/slippage, and compute-normalized comparisons.
