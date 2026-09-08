try {
    var caseId = execution.getVariable('caseId');
    var servicePointId = execution.getVariable('servicePointId');
    var maxAttempts = execution.getVariable('maxAttempts');
    var odooEndpoint = execution.getVariable('odooEndpoint');
    var token = execution.getVariable('token');

    var message =
        'B2WA_case_await_point_active: il service point ' +
        servicePointId +
        ' non e diventato attivo dopo ' +
        maxAttempts +
        ' tentativi.';

    var writeErrUrl;
    var writeErrBody;
    var odooHeaders;

    writeErrUrl = odooEndpoint + 'helpdesk.ticket/' + caseId;
    writeErrBody = {
        error_message: message,
    };
    odooHeaders = [
        {
            'Content-Type': 'application/json',
        },
        {
            Authorization: 'Bearer ' + token,
        },
    ];

    execution.setVariable('writeErrUrl', writeErrUrl);
    execution.setVariable('writeErrBody', JSON.stringify(writeErrBody));
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
    execution.setVariable('errorCode', 'PREP_TIMEOUT_WRITE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
