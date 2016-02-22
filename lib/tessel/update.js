// System Objects
var path = require('path');

// Third Party Dependencies
// ...

// Internal
var commands = require('./commands');
var logs = require('../logs');
var Tessel = require('./tessel');
var updates = require('../update-fetch');

var updatePath = path.join('/tmp/', updates.OPENWRT_BINARY_FILE);
var remoteVersioningFile = '/etc/tessel-version';

/*
  Gathers openWRT and SAMD21 Firmware
  image information.
*/
Tessel.prototype.fetchCurrentBuildInfo = function() {
  // Read the version file
  return this.simpleExec(commands.readFile(remoteVersioningFile))
    .then(function fileRead(fileContents) {
      // Trim the file new line and return
      return fileContents.trim();
    });
};

Tessel.prototype.update = function(newImage) {
  return new Promise((resolve) => {
      if (newImage.openwrt.length > 0) {
        return this.updateOpenWRT(newImage.openwrt).then(resolve);
      } else {
        logs.warn('No OpenWRT binary loaded... skipping OpenWRT update');
        resolve();
      }
    })
    .then(() => {
      return new Promise((resolve) => {
        if (newImage.firmware.length > 0) {
          return this.updateFirmware(newImage.firmware).then(resolve);
        } else {
          logs.warn('No firmware binary loaded... skipping firmware update');
          resolve();
        }
      });
    });
};

Tessel.prototype.updateOpenWRT = function(image) {
  return new Promise((resolve, reject) => {
      logs.info('Updating OpenWRT (1/2)');
      // Write the new image to a file in the /tmp dir
      this.connection.exec(commands.openStdinToFile(updatePath), (err, remoteProc) => {
        if (err) {
          return reject(err);
        }

        logs.info('Transferring image of size', (image.length / 1e6).toFixed(2), 'MB');
        // When we finish writing the image
        remoteProc.once('close', resolve);
        // Write the image
        remoteProc.stdin.end(image);
      });
    })
    .then(() => {
      return new Promise((resolve) => {
        // Begin the sysupgrade
        logs.info('Starting OpenWRT update. Please do not remove power from Tessel.');
        // The USBDaemon will cut out or the SSH command will close
        this.connection.exec(commands.sysupgrade(updatePath), (err, remoteProc) => {
          remoteProc.stdout.on('data', function(d) {
            if (d.toString().includes('Upgrade completed')) {
              resolve();
            }
          });
        });
      });
    });
};

Tessel.prototype.updateFirmware = function(image) {
  return new Promise((resolve, reject) => {
    logs.info('Updating firmware (2/2)');

    // This must be USB connection
    var connection = this.usbConnection;

    if (!connection) {
      return reject('Must have Tessel connected over USB to complete update. Aborting update.');
    }

    return connection.enterBootloader()
      .then((dfu) => this.writeFlash(dfu, image))
      .then(resolve);
  });
};

Tessel.prototype.writeFlash = function(dfu, image) {
  return new Promise(function(resolve, reject) {
    // Download the firmware image
    dfu.dnload(image, function complete(err) {
      if (err) {
        reject(err);
      } else {
        logs.info('Firmware update complete!');
        resolve();
      }
    });
  });
};
