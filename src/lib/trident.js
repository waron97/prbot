import fetch from 'node-fetch';

// Generic Odoo execute_kw call against Trident. Throws on transport or Odoo error.
async function tridentRpc(model, method, args, kwargs = {}) {
    const url = `${process.env.TRIDENT_URL}/jsonrpc`;
    const body = {
        jsonrpc: '2.0',
        method: 'call',
        id: 1,
        params: {
            service: 'object',
            method: 'execute_kw',
            args: [
                process.env.TRIDENT_DB,
                parseInt(process.env.TRIDENT_UID, 10),
                process.env.TRIDENT_TOKEN,
                model,
                method,
                args,
                kwargs,
            ],
        },
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Trident error: ${JSON.stringify(data.error)}`);
    return data.result;
}

export { tridentRpc };
