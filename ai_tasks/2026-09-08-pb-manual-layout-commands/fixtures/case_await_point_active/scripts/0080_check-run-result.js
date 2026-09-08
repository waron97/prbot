try {
    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    var jsonRunResult = JSON.parse(execution.getVariable('runPhaseResult'));
    if (jsonRunResult.code != 200) {
        isAlive = false;
        errorCode = jsonRunResult.code;
        errorMessage = jsonRunResult.body;
    }

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
    execution.setVariable('errorCode', 'RUN_PHASE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
