try {
    var jsonResponse = JSON.parse(
        execution.getVariable('post_sm_order_result')
    );
    if (jsonResponse.code != 200) {
        execution.setVariable('isAlive', false);
        execution.setVariable('errorCode', 'POST_STATEMODEL_FAIL');
        execution.setVariable('errorMessage', 'Service is unavailable.');
    }
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'POST_STATEMODEL_UNEXPECTED_ERROR');
    execution.setVariable('errorMessage', err.message);
}
