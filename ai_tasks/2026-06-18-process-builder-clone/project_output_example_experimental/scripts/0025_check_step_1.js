try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var meter = JSON.parse(execution.getVariable('meter'));
    var start_date = execution.getVariable('start_date');
    var legal_possession_date = execution.getVariable('legal_possession_date');
    var assetType = execution.getVariable('assetType');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var showToast;
    var toasMessage;
    var isFormOk;

    var isRetroactiveVoltura;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function pad(number, width, paddingCharacter) {
        paddingCharacter = paddingCharacter || '0';
        number = number + ''; // Convert to string
        return number.length >= width
            ? number
            : new Array(width - number.length + 1).join(paddingCharacter) + number;
    }

    function formatDateES5(d) {
        var year = d.getFullYear();
        var month = d.getMonth() + 1; // Month is 0-indexed
        var day = d.getDate();

        var paddedMonth = pad(month, 2, '0');
        var paddedDay = pad(day, 2, '0');

        return year + '-' + paddedMonth + '-' + paddedDay;
    }

    function forward() {
        showToast = false;
        toasMessage = '';
        isFormOk = true;
    }

    function backWithMessage(msg) {
        showToast = true;
        toasMessage = msg;
        isFormOk = false;
    }

    function validate() {
        if ((meter.type === 'ce' || meter.type === 'cottimo') && assetType === 'pod') {
            if (start_date.split('-')[2] !== '01') {
                return backWithMessage(
                    'La data di inizio voltura deve essere impostata al primo giorno del mese'
                );
            }
        }

        if (legal_possession_date > start_date) {
            // lexicographic check works for YYYY-MM-DD strings
            return backWithMessage(
                'Data di inizio voltura non può precedere la Data di legittimo possesso'
            );
        }

        return forward();
    }

    function computeRetroactiveVoltura() {
        var today = new Date();
        var todayMonth = today.getMonth() + 1; // getMonth() is 0-11
        var todayDay = today.getDate();
        var volturaMonth = new Date(start_date).getMonth() + 1;

        if (start_date > formatDateES5(today)) {
            if (todayDay > 7) {
                return volturaMonth <= todayMonth + 1;
            } else {
                return volturaMonth <= todayMonth;
            }
        } else {
            return true;
        }
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    validate();

    isRetroactiveVoltura = computeRetroactiveVoltura();

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('isFormOk', isFormOk);
    execution.setVariable('toastMessage', toasMessage);
    execution.setVariable('showToast', showToast);
    execution.setVariable('isRetroactiveVoltura', isRetroactiveVoltura);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
