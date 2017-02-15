/*
 * NodePKI
 * ... a NodeJS-based OpenSSL PKI management server.
 * Originally developed by Thomas Leister for ADITO GmbH.
 * NodePKI is published under MIT License.
 *
 * NodePKI startup file
 * Loads config, prepares CertDB database, starts OCSP server, initializes and starts HTTP server and API.
 */

var exec            = require('child_process').exec;
var util            = require('util');
var fs              = require('fs-extra');
var yaml            = require('js-yaml');
var log             = require('fancy-log');
var express         = require('express');
var figlet          = require('figlet');
var commandExists   = require('command-exists').sync;
var https           = require('https');

var api             = require('./api.js');
var certdb          = require('./certdb.js');
var ocsp            = require('./ocsp-server.js');
var publicsrv       = require('./publicsrv.js');
var fingerprint     = require('./cert_fingerprint.js');

var app             = express();


/***************
* Start server *
***************/

log.info("NodePKI is starting up ...");

console.log(figlet.textSync('NodePKI', {}));
console.log("  By ADITO Software GmbH\n\n");


/*
 * Make sure there is a config file config.yml
 */
if(fs.existsSync('config/config.yml')) {
    log.info("Reading config file config/config.yml ...");
    global.config = yaml.safeLoad(fs.readFileSync('config/config.yml', 'utf8'));
} else {
    // There is no config file yet. Create one from config.yml.default and quit server.
    log("No custom config file 'config/config.yml' found.");
    fs.ensureDirSync('config');
    fs.copySync('config.default.yml', 'config/config.yml');
    log("Default config file was copied to config/config.yml.");
    console.log("\
**********************************************************************\n\
***     Please customize config/config.yml according to your       ***\n\
***                 environment and restart script.                ***\n\
**********************************************************************");

    log("Server will now quit.");
    process.exit();
}


/*
 * Check if the openssl command is available
 */

if(commandExists('openssl') === false) {
    log("openssl command is not available. Please install openssl.")
    process.exit();
}


/*
 * Check if there is a PKI directory with all the OpenSSL contents.
 */

fs.ensureDir('mypki');
if(fs.existsSync('mypki/created') === false) {
    log("There is no PKI available. Please generate the content of mypki by executing 'nodejs genpki.js'.");
    process.exit();
}


// Ensure tmp dir
fs.ensureDir('tmp');

// Base Base path of the application
global.paths = {
    basepath: __dirname + "/",
    pkipath: __dirname + "/mypki/",
    tempdir: __dirname + "/tmp/"
};


// Re-index cert database
certdb.reindex().then(function(){
    /*
     * Start HTTPS server for encrypted API calls
     */
    https.createServer({
        key: fs.readFileSync(global.paths.pkipath + 'apicert/key.pem'),
        cert: fs.readFileSync(global.paths.pkipath + 'apicert/cert.pem')
    }, app).listen(global.config.server.api.port, global.config.server.ip, function() {
        log(">>>>>> HTTPS API-Server is listening on " + global.config.server.ip + ":" + global.config.server.api.port + " <<<<<<")
    });

    log.info("Registering HTTPS API endpoints");
    api.initAPI(app);
}).catch(function(error){
    log.error("Could not initialize CertDB index: " + error);
});


// Start OCSP server
ocsp.startServer()
.then(function(){
    log.info("OCSP-Server is running");
})
.catch(function(error){
    log.error("Could not start OCSP server: " + error);
});


// Start Public HTTP server
publicsrv.startHTTPServer();


// Show Root Cert fingerprint
fingerprint.getFingerprint(global.paths.pkipath + 'root/root.cert.pem').then(function(fingerprint_out) {
    log(">>>>>> Root CA Fingerprint: " + fingerprint_out);
})
.catch(function(err) {
    log.error("Could not get Root CA fingerprint!")
});



/*
 * CRL renewal cronjob
 */
var crlrenewint = 1000 * 60 * 60 * 24; // 24h
setInterval(publicsrv.createCRL, crlrenewint);



/*********************************
* Server stop routine and events *
*********************************/

var stopServer = function() {
    log("Received termination signal.");
    log("Stopping OCSP server ...");
    ocsp.stopServer();

    log("Bye!");
    process.exit();
};

process.on('SIGINT', stopServer);
process.on('SIGHUP', stopServer);
process.on('SIGQUIT', stopServer);



// Export app variable
module.exports = {
    app: app,
};
