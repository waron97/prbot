try {
    var jsonTemplate = JSON.parse(execution.getVariable('template'));

    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    execution.setVariable('odooEndpoint', jsonTemplate.odooEndpoint);

    execution.setVariable('keyCloakEndpoint', jsonTemplate.keyCloakEndpoint);
    execution.setVariable(
        'keyCloakHeaders',
        JSON.stringify(jsonTemplate.keyCloakHeaders)
    );
    execution.setVariable('keyCloakBody', jsonTemplate.keyCloakBody);

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
    execution.setVariable('errorCode', 'TEMPLATE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
