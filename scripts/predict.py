import argparse, json, requests

parser = argparse.ArgumentParser(description='Call the RIFT ML inference API')
parser.add_argument('endpoint', choices=['flood','cyclone','earthquake','infrastructure'])
parser.add_argument('--file', default='ml/data/sample_inputs.json')
parser.add_argument('--url', default='http://127.0.0.1:8000')
args = parser.parse_args()
with open(args.file, encoding='utf-8') as f:
    data = json.load(f)[args.endpoint]
r = requests.post(f'{args.url}/predict/{args.endpoint}', json=data, timeout=20)
r.raise_for_status()
print(json.dumps(r.json(), indent=2))
