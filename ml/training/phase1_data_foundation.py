"""Phase 1: verify/register dataset schemas used by the ML pipeline."""
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
FILES=['flood_demo.csv','cyclone_demo.csv','earthquake_demo.csv','infrastructure_demo.csv']
for f in FILES:
    p=ROOT/'ml'/'data'/f
    if not p.exists(): raise FileNotFoundError(p)
    df=pd.read_csv(p,nrows=5)
    print(f, 'OK', list(df.columns))
