try {
    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    var jsonWriteResult = JSON.parse(execution.getVariable('writeErrResult'));
    if (jsonWriteResult.code != 200) {
        isAlive = false;
        errorCode = jsonWriteResult.code;
        errorMessage = jsonWriteResult.body;
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
    execution.setVariable('errorCode', 'WRITE_ERROR_MESSAGE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
