var omd = require('online_mp4_duration');
function get(url, cb){
    /*
        url check logic
        UM
    */
    omd({url: url, full_scan: true}, function(err, duration){
        if(err){
            cb(err);
            return;
        }
        cb(null, {
            time: duration, // in sec
        });
    });
}
module.exports = get;