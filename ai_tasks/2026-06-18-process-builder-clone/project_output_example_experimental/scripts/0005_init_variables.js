try {
    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    execution.setVariable('showToast', false);
    execution.setVariable('toastMessage', '');

    //Get template information stored in symphony in template
    var jsonTemplate = JSON.parse(execution.getVariable('template'));

    //Store the endpoint read from the template in a symphony variable to use it in the next steps
    execution.setVariable('meteringEndpoint', jsonTemplate.meteringEndpoint);
    execution.setVariable('keyCloakEndpoint', jsonTemplate.keyCloakEndpoint);
    execution.setVariable(
        'keyCloakHeaders',
        JSON.stringify(jsonTemplate.keyCloakHeaders)
    );
    execution.setVariable('keyCloakBody', jsonTemplate.keyCloakBody);
    execution.setVariable('odooEndpoint', jsonTemplate.odooEndpoint);
    execution.setVariable('pollingEndpoint', jsonTemplate.pollingEndpoint);
    execution.setVariable('b2wEndpoint', jsonTemplate.b2wEndpoint);
    execution.setVariable('tenantId', jsonTemplate.tenantId);
    execution.setVariable('orgToken', jsonTemplate.orgToken);
    execution.setVariable(
        'meteringKeyCloakEndpoint',
        jsonTemplate.meteringKeyCloakEndpoint
    );
    execution.setVariable(
        'meteringKeyCloakHeaders',
        JSON.stringify(jsonTemplate.meteringKeyCloakHeaders)
    );
    execution.setVariable(
        'meteringKeyCloakBody',
        jsonTemplate.meteringKeyCloakBody
    );
    execution.setVariable('status', 'SUCCESS');

    execution.setVariable('CDNEndpoint', jsonTemplate.CDNEndpoint);

    var accessToken = execution.getVariable('X-Auth-Request-Access-Token');

    if (!accessToken) {
        var request = JSON.parse(execution.getVariable('request'));
        accessToken = request['X-Auth-Request-Access-Token'];
    }

    execution.setVariable('token', accessToken);
    execution.setVariable('cartB2WEndpoint', jsonTemplate.cartB2WEndpoint);
    execution.setVariable('cartapibaseurl', jsonTemplate.cartapibaseurl);

    execution.setVariable('mlPricelistId', jsonTemplate.mlPricelistGuid);
    execution.setVariable('mlCatalogId', jsonTemplate.mlCatalogGuid);

    execution.setVariable('tgCatalogId', jsonTemplate.tgCatalogGuid);
    execution.setVariable('tgPricelistId', jsonTemplate.tgPricelistGuid);

    execution.setVariable('isAlive', isAlive);
    execution.setVariable('errorCode', errorCode);
    execution.setVariable('errorMessage', errorMessage);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'INIT_FAILED');
    execution.setVariable('errorMessage', err.message);
}
