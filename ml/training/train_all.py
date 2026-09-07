from pathlib import Path
import json, math, joblib, pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, roc_auc_score, mean_absolute_error, mean_squared_error, r2_score

ROOT=Path(__file__).resolve().parents[2]
MODEL_DIR=ROOT/'ml/models'; METRIC_DIR=ROOT/'ml/metrics'
MODEL_DIR.mkdir(parents=True,exist_ok=True); METRIC_DIR.mkdir(parents=True,exist_ok=True)
SPECS=[
{'name':'flood_risk_v1','file':'flood_demo.csv','target':'flood_occurred','cat':['soil_type'],'kind':'clf'},
{'name':'cyclone_impact_v1','file':'cyclone_demo.csv','target':'next_wind_kts','cat':[],'kind':'reg'},
{'name':'earthquake_impact_v1','file':'earthquake_demo.csv','target':'impact_score','cat':[],'kind':'reg'},
{'name':'infrastructure_vulnerability_v1','file':'infrastructure_demo.csv','target':'vulnerability_class','cat':['asset_type'],'kind':'clf'}]

def run(s):
    df=pd.read_csv(ROOT/'ml/data'/s['file'])
    X=df.drop(columns=[s['target']]); y=df[s['target']]
    if s['cat']: X=pd.get_dummies(X,columns=s['cat'],dtype=float)
    strat=y if s['kind']=='clf' else None
    Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=.2,random_state=42,stratify=strat)
    est=(RandomForestClassifier(n_estimators=80,max_depth=12,min_samples_leaf=2,random_state=42,n_jobs=-1,class_weight='balanced') if s['kind']=='clf' else RandomForestRegressor(n_estimators=80,max_depth=14,min_samples_leaf=2,random_state=42,n_jobs=-1))
    pipe=Pipeline([('imputer',SimpleImputer(strategy='median')),('scaler',StandardScaler()),('model',est)])
    pipe.fit(Xtr,ytr); pred=pipe.predict(Xte)
    m={'model_version':s['name'],'training_rows':len(Xtr),'test_rows':len(Xte),'features':X.columns.tolist()}
    if s['kind']=='clf':
        p,r,f,_=precision_recall_fscore_support(yte,pred,average='weighted',zero_division=0); m.update({'accuracy':accuracy_score(yte,pred),'precision_weighted':p,'recall_weighted':r,'f1_weighted':f})
        proba=pipe.predict_proba(Xte); m['roc_auc']=roc_auc_score(yte,proba[:,1]) if len(set(yte))==2 else roc_auc_score(yte,proba,multi_class='ovr')
    else:
        m.update({'mae':mean_absolute_error(yte,pred),'rmse':math.sqrt(mean_squared_error(yte,pred)),'r2':r2_score(yte,pred)})
    joblib.dump({'model':pipe,'features':X.columns.tolist(),'target':s['target'],'name':s['name'],'task':s['kind']},MODEL_DIR/f"{s['name']}.joblib",compress=3)
    (METRIC_DIR/f"{s['name']}.json").write_text(json.dumps(m,indent=2))
    return m

results={s['name']:run(s) for s in SPECS}
(METRIC_DIR/'all_models.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
