try {
    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    var jsonKeyCloakResult = JSON.parse(execution.getVariable('keyCloakResult'));
    if (jsonKeyCloakResult.code == 200) {
        var data = JSON.parse(jsonKeyCloakResult.body);
        var accessToken = data['access_token'];
        execution.setVariable('token', accessToken);
    } else {
        isAlive = false;
        errorCode = jsonKeyCloakResult.code;
        errorMessage = jsonKeyCloakResult.body;
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
    execution.setVariable('errorCode', 'CHECK_AUTH_TOKEN_FAILED');
    execution.setVariable('errorMessage', err.message);
}
