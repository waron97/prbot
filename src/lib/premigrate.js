import fs from 'fs/promises';
import path from 'path';

function parseXmlMappings(content) {
    const phases = new Map();
    const results = new Map();

    const chunks = content.split('<record ');
    for (const chunk of chunks) {
        const idMatch = chunk.match(/^id="([^"]+)"/);
        if (!idMatch) continue;
        const xmlId = idMatch[1];

        const modelMatch = chunk.match(/model="(symple\.triplet\.phase(?:\.result)?)"/);
        if (!modelMatch) continue;
        const model = modelMatch[1];

        if (model === 'symple.triplet.phase') {
            const codeMatch = chunk.match(/<field name="phase_code">([^<]+)<\/field>/);
            if (codeMatch) phases.set(codeMatch[1].trim(), xmlId);
        } else if (model === 'symple.triplet.phase.result') {
            const codeMatch = chunk.match(/<field name="state_code">([^<]+)<\/field>/);
            if (codeMatch) results.set(codeMatch[1].trim(), xmlId);
        }
    }

    return { phases, results };
}

async function readWorkflowMappings(dataDir) {
    const phases = new Map();
    const results = new Map();

    const files = ['workflow_configuration.xml', 'workflow_missing_relations.xml'];
    for (const filename of files) {
        try {
            const content = await fs.readFile(path.join(dataDir, filename), 'utf-8');
            const { phases: p, results: r } = parseXmlMappings(content);
            for (const [k, v] of p) phases.set(k, v);
            for (const [k, v] of r) results.set(k, v);
        } catch {
            // file doesn't exist yet; skip
        }
    }

    return { phases, results };
}

function detectRenames(oldMaps, newMaps) {
    const stateCodes = [];
    const phaseCodes = [];

    for (const [code, oldXmlId] of oldMaps.results) {
        const newXmlId = newMaps.results.get(code);
        if (newXmlId && newXmlId !== oldXmlId) stateCodes.push(code);
    }

    for (const [code, oldXmlId] of oldMaps.phases) {
        const newXmlId = newMaps.phases.get(code);
        if (newXmlId && newXmlId !== oldXmlId) phaseCodes.push(code);
    }

    return { stateCodes, phaseCodes };
}

async function computeMigrationVersion(manifestPath, bumpLevel) {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const versionMatch = content.match(/"version":\s*"(15\.0\.\d+\.\d+\.\d+)"/);
    if (!versionMatch) throw new Error('Version not found in manifest');

    const parts = versionMatch[1].split('.');
    const base = `${parts[0]}.${parts[1]}`;
    const major = parseInt(parts[2]);
    const minor = parseInt(parts[3]);
    const patch = parseInt(parts[4]);

    if (bumpLevel === 'major') return `${base}.${major + 1}.0.0`;
    if (bumpLevel === 'minor') return `${base}.${major}.${minor + 1}.0`;
    if (bumpLevel === 'patch') return `${base}.${major}.${minor}.${patch + 1}`;
    return `${base}.${major}.${minor + 1}.0`;
}

function generatePreMigrateScript(stateCodes, phaseCodes) {
    const lines = [
        '# Copyright 2025-TODAY Symphonie Prime S.r.l. (www.symphonieprime.com)',
        '# All rights reserved.',
        '',
        'from openupgradelib import openupgrade',
        '',
        '',
        '@openupgrade.migrate()',
        'def migrate(env, version):',
        '    env.cr.execute(',
        '        "SELECT 1 FROM information_schema.tables WHERE table_name = %s",',
        '        ("symple_triplet_phase_result",),',
        '    )',
        '    if not env.cr.fetchone():',
        '        return',
    ];

    if (stateCodes.length > 0) {
        lines.push('');
        if (stateCodes.length === 1) {
            lines.push(`    state_codes = ("${stateCodes[0]}",)`);
        } else {
            lines.push('    state_codes = (');
            for (const code of stateCodes) lines.push(`        "${code}",`);
            lines.push('    )');
        }
        lines.push(
            '    env.cr.execute(',
            '        "DELETE FROM result_code_configurator WHERE triplet_phase_result_id IN (SELECT id FROM symple_triplet_phase_result WHERE state_code IN %s)",',
            '        (state_codes,),',
            '    )',
            '    env.cr.execute(',
            '        "DELETE FROM symple_triplet_phase_result WHERE state_code IN %s",',
            '        (state_codes,),',
            '    )',
        );
    }

    if (phaseCodes.length > 0) {
        lines.push('');
        if (phaseCodes.length === 1) {
            lines.push(`    phase_codes = ("${phaseCodes[0]}",)`);
        } else {
            lines.push('    phase_codes = (');
            for (const code of phaseCodes) lines.push(`        "${code}",`);
            lines.push('    )');
        }
        lines.push(
            '    env.cr.execute(',
            '        "DELETE FROM symple_triplet_phase WHERE phase_code IN %s",',
            '        (phase_codes,),',
            '    )',
        );
    }

    return lines.join('\n') + '\n';
}

function parseEmailTemplateMappings(content) {
    const templates = new Map();

    const chunks = content.split('<record ');
    for (const chunk of chunks) {
        const idMatch = chunk.match(/^id="([^"]+)"/);
        if (!idMatch) continue;
        const xmlId = idMatch[1];

        if (!chunk.match(/model="mail\.template"/)) continue;

        const codeMatch = chunk.match(/<field name="template_code">([^<]+)<\/field>/);
        if (codeMatch) templates.set(codeMatch[1].trim(), xmlId);
    }

    return templates;
}

async function readEmailTemplateMappings(dataDir) {
    try {
        const content = await fs.readFile(path.join(dataDir, 'mail_template.xml'), 'utf-8');
        return parseEmailTemplateMappings(content);
    } catch {
        return new Map();
    }
}

function detectEmailRenames(oldMap, newMap) {
    const renames = [];
    for (const [code, oldXmlId] of oldMap) {
        const newXmlId = newMap.get(code);
        if (newXmlId && newXmlId !== oldXmlId) renames.push({ oldXmlId, newXmlId });
    }
    return renames;
}

function generateEmailPreMigrateScript(renames, module) {
    const lines = [
        '# Copyright 2025-TODAY Symphonie Prime S.r.l. (www.symphonieprime.com)',
        '# All rights reserved.',
        '',
        'from openupgradelib import openupgrade',
        '',
        '',
        '@openupgrade.migrate()',
        'def migrate(env, version):',
        '    renames = [',
    ];

    for (const { oldXmlId, newXmlId } of renames) {
        lines.push(`        ("${oldXmlId}", "${newXmlId}"),`);
    }

    lines.push(
        '    ]',
        '    for old_name, new_name in renames:',
        '        env.cr.execute(',
        `            "UPDATE ir_model_data SET name = %s WHERE name = %s AND model = %s AND module = %s",`,
        `            (new_name, old_name, "mail.template", "${module}"),`,
        '        )',
    );

    return lines.join('\n') + '\n';
}

export {
    readWorkflowMappings,
    detectRenames,
    computeMigrationVersion,
    generatePreMigrateScript,
    readEmailTemplateMappings,
    detectEmailRenames,
    generateEmailPreMigrateScript,
};
