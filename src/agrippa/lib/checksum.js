import { createHash } from 'crypto';

function computeChecksum(code) {
    return createHash('md5').update((code ?? '').trim()).digest('hex');
}

export { computeChecksum };
