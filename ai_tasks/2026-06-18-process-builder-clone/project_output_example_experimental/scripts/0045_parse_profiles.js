try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var pmResponse = JSON.parse(execution.getVariable('pm_response'));
    var sddResponse = JSON.parse(execution.getVariable('sdd_response'));
    var addressResponse = JSON.parse(execution.getVariable('address_response'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var incomingClientProfiles;
    var incomingClientSddMethods;
    var incomingClientAddresses;
    var hasActiveProfile;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arraySome(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return true;
            }
        }
        return false;
    }

    function arrayMap(arr, fn) {
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
            mapped.push(fn(arr[i], i, mapped));
        }
        return mapped;
    }

    function arrayFilter(arr, fn) {
        var filtered = [];
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, filtered)) {
                filtered.push(arr[i]);
            }
        }
        return filtered;
    }

    // ----------------------------

    function checkMethodCb(profile) {
        return function (p) {
            return p.payment_method_id === profile.payment_method_id;
        };
    }

    function computeFullName(profile) {
        profile.computedOwnerFullName = arrayFilter(
            [profile.account_owner_name, profile.account_owner_surname],
            Boolean
        ).join(' ');
        return profile;
    }

    function getSddProfiles(profiles) {
        var sddProfiles = arrayFilter(profiles, function (profile, index, self) {
            return profile.payment_method === 'sdd' && !arraySome(self, checkMethodCb(profile));
        });

        return arrayMap(sddProfiles, computeFullName);
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (pmResponse.code !== 200) {
        throw new Error('search_payment_method returned non-200 response');
    }

    if (sddResponse.code !== 200) {
        throw new Error('search_sff returned non-200 response');
    }

    if (addressResponse.code !== 200) {
        throw new Error('get_addresses returned non-200 response');
    }

    var profilesBody = JSON.parse(pmResponse.body || '[]');
    var sddBody = JSON.parse(sddResponse.body || '[]');
    var addressBody = JSON.parse(addressResponse.body || '[]');

    incomingClientProfiles = profilesBody;
    incomingClientSddMethods = getSddProfiles(sddBody);
    incomingClientAddresses = addressBody;

    if (incomingClientProfiles.length > 0) {
        hasActiveProfile = 'Y';
    } else {
        hasActiveProfile = 'N';
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('incomingClientSddMethods', JSON.stringify(incomingClientSddMethods));
    execution.setVariable('incomingClientProfiles', JSON.stringify(incomingClientProfiles));
    execution.setVariable('incomingClientAddresses', JSON.stringify(incomingClientAddresses));
    execution.setVariable('hasActiveProfile', hasActiveProfile);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
