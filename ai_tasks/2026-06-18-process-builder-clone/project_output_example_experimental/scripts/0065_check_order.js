try {
    var jsonResponse = JSON.parse(execution.getVariable('post_order_result'));
    if (jsonResponse.code == 200) {
        var body = JSON.parse(jsonResponse.body);
        var inputdata = {
            bp_value: {
                currentStatus: 'Active',
                obj_id: body._id,
                obj_number: body.obj_number,
                conf_id: body.conf_id,
                seq_data: body.seq_data,
                obj_type: 'Order',
            },
            bp_session: true,
        };
        execution.setVariable('b2w-input-data', JSON.stringify(inputdata));
        execution.setVariable('order_id', body._id);
        execution.setVariable('config_id', body.conf_id);
    } else {
        execution.setVariable('isAlive', true);
    }
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'CHECK_ORDER_CREATION_FAIL_UNEXPECTED_ERROR');
    execution.setVariable('errorMessage', err.message);
}
