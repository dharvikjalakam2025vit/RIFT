from train_all import run, SPECS
for s in SPECS:
    print('TRAIN', s['name']); print(run(s))
# Train the model using the prepared training data.
# The existing training configuration and parameters are intentionally unchanged.