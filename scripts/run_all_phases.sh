#!/usr/bin/env bash
set -e
python ml/training/phase1_data_foundation.py
python ml/training/phase2_preprocess.py
python ml/training/phase3_features.py
python ml/training/train_all.py
python ml/evaluation/phase5_evaluate.py
