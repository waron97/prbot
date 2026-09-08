try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var caseId = execution.getVariable('caseId');
    var phaseCode = execution.getVariable('phaseCode');
    var token = execution.getVariable('token');
    var odooEndpoint = execution.getVariable('odooEndpoint');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var runPhaseUrl;
    var runPhaseBody;
    var odooHeaders;

    // ----------------------------
    // Main Execution
    // ----------------------------

    runPhaseUrl = odooEndpoint + 'helpdesk.ticket/run_code_and_set_result';
    runPhaseBody = {
        ticket_id: caseId,
        phase_code: phaseCode,
    };
    odooHeaders = [
        {
            'Content-Type': 'application/json',
        },
        {
            Authorization: 'Bearer ' + token,
        },
    ];

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('runPhaseUrl', runPhaseUrl);
    execution.setVariable('runPhaseBody', JSON.stringify(runPhaseBody));
    execution.setVariable('odooHeaders', JSON.stringify(odooHeaders));

    execution.setVariable('isAlive', true);
    execution.setVariable('errorCode', '0');
    execution.setVariable('errorMessage', '');
} catch (err) {
    var symphonyCustomResponse = {
        code: 'GEN_ERROR',
        message: err.message,
    };

    execution.setVariable(
        'symphonyCustomResponse',
        JSON.stringify(symphonyCustomResponse)
    );

    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'PREP_RUN_PHASE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
