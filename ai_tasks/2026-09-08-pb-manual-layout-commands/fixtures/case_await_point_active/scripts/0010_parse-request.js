try {
    // ----------------------------
    // Input gathering
    // ----------------------------
    var jsonRequest = JSON.parse(execution.getVariable('request'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (!jsonRequest.case_id) {
        throw new Error('Received no case_id on request.');
    }
    if (!jsonRequest.service_point_id) {
        throw new Error('Received no service_point_id on request.');
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('caseId', jsonRequest.case_id);
    execution.setVariable('servicePointId', jsonRequest.service_point_id);
    execution.setVariable('phaseCode', jsonRequest.phase_code || '');

    execution.setVariable('attempt', 0);
    execution.setVariable('maxAttempts', 10);

    execution.setVariable('isAlive', isAlive);
    execution.setVariable('errorCode', errorCode);
    execution.setVariable('errorMessage', errorMessage);
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
    execution.setVariable('errorCode', 'PARSE_REQUEST_FAILED');
    execution.setVariable('errorMessage', err.message);
}
