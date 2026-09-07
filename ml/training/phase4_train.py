from train_all import run, SPECS
for s in SPECS:
    print('TRAIN', s['name']); print(run(s))
