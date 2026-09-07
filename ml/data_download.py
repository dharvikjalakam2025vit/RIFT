"""Optional real-data downloader helpers.
These are intentionally separate from the checked-in prototype training fixtures.
"""
from pathlib import Path
from urllib.request import urlretrieve

ROOT = Path(__file__).resolve().parents[0]
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)

IBTRACS_NI = 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv'

def download_ibtracs_ni():
    target = DATA / 'ibtracs.NI.list.v04r01.csv'
    urlretrieve(IBTRACS_NI, target)
    return target

if __name__ == '__main__':
    print(download_ibtracs_ni())
