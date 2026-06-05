import requests, json, sys

N8N_URL = 'https://workflows.vendly.chat'
N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjOTVmNTNmZS0zNGYyLTQ2ZWYtODZiZi1kZDFlYWE2MTQyZDYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiOTM3NjE5OTUtMzMxYy00NTcyLTlmODgtNmIzYTA1MGU1ZDg5IiwiaWF0IjoxNzc4OTU0MzAyfQ.ULL6jWDVEI9hGBRfk86nlo59o5UbPXzLt8qgpxeIDWs'
WORKFLOW_ID = 'jleu4RPvSnYDL8Gd'

# HTTP Request node que chama /agent-loop no servidor MCP.
# O servidor implementa o loop ilimitado de tool calls em Node.js puro (sem sandbox).
# Body: openRouterBody (ja montado pelo Construir Prompt) + businessId + instance.
AGENTE_LOOP_NODE = {
    "id": "agente-loop-unlimited",
    "name": "Agente Loop",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [1392, 544],
    "parameters": {
        "method": "POST",
        "url": "https://app.vendly.chat/agent-loop",
        "sendBody": True,
        "specifyBody": "json",
        # openRouterBody e objeto, businessId vem do MongoDB GET Business, instance do payload
        "jsonBody": "={{ JSON.stringify({ openRouterBody: $json.openRouterBody, businessId: String($('MongoDB GET Business').first()?.json?._id ?? $json.instance ?? ''), instance: String($json.instance ?? '') }) }}",
        "options": {
            "response": {
                "response": {
                    "neverError": True
                }
            },
            "timeout": 90000  # 90s timeout para comportar multiplos rounds
        }
    }
}


def main():
    print("Fetching production workflow...")
    resp = requests.get(f'{N8N_URL}/api/v1/workflows/{WORKFLOW_ID}',
                        headers={'X-N8N-API-KEY': N8N_KEY})
    resp.raise_for_status()
    wf = resp.json()
    print(f"  Got: {wf['name']}, {len(wf.get('nodes', []))} nodes")

    # Backup
    with open('wf_production_backup.json', 'w', encoding='utf-8') as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
    print("  Backup saved: wf_production_backup.json")

    # Remove existing Agente Loop (any version)
    existing_ids = {n['id'] for n in wf.get('nodes', [])}
    if 'agente-loop-unlimited' in existing_ids:
        print("  Removing old Agente Loop node")
        wf['nodes'] = [n for n in wf['nodes'] if n['id'] != 'agente-loop-unlimited']

    # Add new HTTP Request node
    wf['nodes'].append(AGENTE_LOOP_NODE)
    print(f"  Added 'Agente Loop' (HTTP Request -> /agent-loop)")

    # Update connections
    conns = wf['connections']

    # Construir Prompt -> Agente Loop (was -> OpenRouter or already -> Agente Loop)
    before = []
    if 'Construir Prompt' in conns:
        for branch in conns['Construir Prompt']['main']:
            for conn in branch:
                before.append(conn['node'])
                if conn['node'] in ('OpenRouter', 'Agente Loop'):
                    conn['node'] = 'Agente Loop'
    print(f"  Construir Prompt was -> {before}, now -> Agente Loop")

    # Agente Loop -> Parsear Chunks
    conns['Agente Loop'] = {
        'main': [[{'node': 'Parsear Chunks', 'type': 'main', 'index': 0}]]
    }
    print(f"  Added: Agente Loop -> Parsear Chunks")
    print(f"  Total nodes: {len(wf['nodes'])}")

    # Save for review
    with open('wf_updated.json', 'w', encoding='utf-8') as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
    print("  Saved wf_updated.json")

    # Push — only send allowed fields (binaryMode rejected by API)
    settings = {k: v for k, v in wf.get('settings', {}).items() if k != 'binaryMode'}
    body = {
        'name': wf['name'],
        'nodes': wf['nodes'],
        'connections': wf['connections'],
        'settings': settings,
        'staticData': wf.get('staticData'),
    }
    print("\nPushing to production...")
    r = requests.put(
        f'{N8N_URL}/api/v1/workflows/{WORKFLOW_ID}',
        headers={'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json'},
        json=body,
        timeout=30
    )
    print(f"  Status: {r.status_code}")
    if r.status_code == 200:
        result = r.json()
        print(f"  OK: {result.get('name')} updated, {len(result.get('nodes', []))} nodes")
    else:
        print(f"  ERROR: {r.text[:500]}")
        sys.exit(1)

    print("\nDone!")


if __name__ == '__main__':
    main()
