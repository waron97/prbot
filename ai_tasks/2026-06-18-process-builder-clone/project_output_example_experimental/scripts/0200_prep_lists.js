try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var volturaStartDate = execution.getVariable('start_date');

    var catalog_guid = execution.getVariable('catalog_guid');
    var pricelist_guid = execution.getVariable('pricelist_guid');

    var canSeeWholeCatalog = execution.getVariable('can_see_whole_catalog');
    var products = JSON.parse(execution.getVariable('products'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var listsFilter;
    var catalogDateFilter;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arrayMap(arr, fn) {
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
            mapped.push(fn(arr[i], i, arr));
        }
        return mapped;
    }

    // ----------------------------

    function formatDateToYYYYMMDD(date) {
        var year = date.getFullYear();
        var month = date.getMonth() + 1;
        if (month < 10) {
            month = '0' + month;
        }
        var day = date.getDate();
        if (day < 10) {
            day = '0' + day;
        }
        return year + '-' + month + '-' + day;
    }

    function getCatalogDateFilter() {
        var volturaDate = new Date(volturaStartDate);
        var currentDate = new Date();

        var isDatePast =
            volturaDate.getFullYear() < currentDate.getFullYear() ||
            (volturaDate.getFullYear() === currentDate.getFullYear() &&
                volturaDate.getMonth() < currentDate.getMonth());

        if (isDatePast) {
            return formatDateToYYYYMMDD(volturaDate) + 'T00:00:00Z';
        } else {
            return formatDateToYYYYMMDD(currentDate) + 'T00:00:00Z';
        }
    }

    function getCompleteFilter(date) {
        var components = [
            { status: 'PUBLISHED' },
            {
                end_validity_pricelist: {
                    $gte: date,
                },
            },
            {
                start_validity_pricelist: {
                    $lte: date,
                },
            },
            {
                product_id: {
                    $in: arrayMap(products, function (product) {
                        return product._id;
                    }),
                },
            },
        ];

        if (!canSeeWholeCatalog) {
            components.push({ pricelist_qualification: 'Voltura' });
        }

        return {
            filters: components,
            size: 1000000,
            page: 1,
            group_to_show: 'all',
            catalog_guid: catalog_guid,
            pricelist_guid: pricelist_guid,
        };
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    catalogDateFilter = getCatalogDateFilter();
    listsFilter = getCompleteFilter(catalogDateFilter);

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('listsFilter', JSON.stringify(listsFilter));
    execution.setVariable('catalogDateFilter', catalogDateFilter);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_PREP_LISTS');
    execution.setVariable('errorMessage', err.message);
}
