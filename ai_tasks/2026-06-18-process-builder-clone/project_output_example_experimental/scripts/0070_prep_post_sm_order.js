try {
    var post_statemodel_body = {
        sm_name: 'order',
        sm_version: 1,
        sm_state: 'in_preparazione',
        sm_reason: 'In Order Digital',
    };

    execution.setVariable('post_sm_order_body', JSON.stringify(post_statemodel_body));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'PROCESS_ORDER_CREATION_FAIL_UNEXPECTED_ERROR');
    execution.setVariable('errorMessage', err.message);
}
