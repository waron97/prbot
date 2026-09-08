try {
    var isAlive = true;
    var errorCode = '0';
    var errorMessage = '';

    var attempt = execution.getVariable('attempt');
    var pointActive = false;

    // Un errore HTTP sulla singola lettura non ferma il processo: conta come
    // tentativo non riuscito (pointActive resta false) e si riprova al giro
    // successivo, entro il numero massimo di tentativi (nessun abort qui).
    var jsonSpResult = JSON.parse(execution.getVariable('spResult'));
    if (jsonSpResult.code == 200) {
        var servicePoint = JSON.parse(jsonSpResult.body);
        pointActive = servicePoint.state == 'active';
    }

    attempt = attempt + 1;

    execution.setVariable('pointActive', pointActive);
    execution.setVariable('attempt', attempt);

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
    execution.setVariable('errorCode', 'EVALUATE_SP_STATE_FAILED');
    execution.setVariable('errorMessage', err.message);
}
