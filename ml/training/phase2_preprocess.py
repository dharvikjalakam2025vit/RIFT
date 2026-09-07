"""Phase 2: preprocessing smoke test. The production training script fits preprocessing on train data only."""
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
for f in ['flood_demo.csv','cyclone_demo.csv','earthquake_demo.csv','infrastructure_demo.csv']:
    df=pd.read_csv(ROOT/'ml/data'/f)
    print(f, 'rows=',len(df), 'missing=', int(df.isna().sum().sum()), 'duplicates=', int(df.duplicated().sum()))
