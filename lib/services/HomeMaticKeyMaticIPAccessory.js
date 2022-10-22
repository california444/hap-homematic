/*
 * File: HomeMaticKeyMaticIPAccessory.js
 * Project: hap-homematic
 * File Created: 14.04.2021 5:49:23 pm
 * Author: Thomas Kluge (th.kluge@me.com)
 * -----
 * The MIT License (MIT)
 *
 * Copyright (c) Thomas Kluge <th.kluge@me.com> (https://github.com/thkl)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ==========================================================================
 */

const { parse } = require('commander')
const path = require('path')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))

module.exports = class HomeMaticKeyMaticIPAccessory extends HomeMaticAccessory {
  publishServices(Service, Characteristic) {
    const self = this
    const service = this.addService(new Service.LockMechanism(this._name))
    const unlockMode = this.getDeviceSettings().unlockMode || 'unlock'
    const addDoorOpener = this.getDeviceSettings().addDoorOpener || false

    this.lockCurrentState = service.getCharacteristic(Characteristic.LockCurrentState)
      .on('get', (callback) => {
        self.debugLog('LockCurrentState get called')
        self.getValue('LOCK_STATE', true).then((value) => {
          self.debugLog('hk get lockCurrentState result from ccu is %s', value)
          if (callback) {
            switch (parseInt(value)) {
              case 0:
                callback(null, Characteristic.LockCurrentState.UNSECURED)
                break
              case 1:
                callback(null, Characteristic.LockCurrentState.SECURED)
                break
              case 2:
                callback(null, Characteristic.LockCurrentState.UNSECURED)
                break
              default:
                self.debugLog('unknown LockCurrentState value %s', value)
                callback(null, Characteristic.LockCurrentState.UNSECURED)

            }
          } else {
            self.log.error('No Callback provided')
          }
        })
      })
      .on('set', (value, callback) => {
        self.debugLog('hk set lockCurrentState will be ignored')
        callback()
      })

    this.lockCurrentState.eventEnabled = true

    this.lockTargetState = service.getCharacteristic(Characteristic.LockTargetState)
      .on('get', (callback) => {
        self.debugLog('LockTargetState get called ask LOCK_STATE')

        self.getValue('LOCK_STATE', true).then((value) => {
          self.debugLog('hk get lockTargetState result from ccu is %s', value)

          if (callback) {
            switch (parseInt(value)) {
              case 0:
                callback(null, Characteristic.LockTargetState.UNSECURED)
                break
              case 1:
                callback(null, Characteristic.LockTargetState.SECURED)
                break
              case 2:
                callback(null, Characteristic.LockTargetState.UNSECURED)
                break
              default:
                self.debugLog('unknown LockTargetState value %s', value)
                callback(null, Characteristic.LockTargetState.UNSECURED)
            }
          }
        })
      })

      .on('set', (value, callback) => {
        // check config settings what to do
        self.lockEvents = true // disable events
        self.debugLog('hk set lockTargetState value is %s', value)
        if (value === Characteristic.LockTargetState.UNSECURED) {
          self.debugLog('unlock command')
          if (unlockMode === 'open') {
            self.debugLog('unlock mode is open send open command to ccu')
            self.setValue('LOCK_TARGET_LEVEL', 2)
          } else {
            self.debugLog('unlock mode is normal send state 0 command to ccu')
            self.setValue('LOCK_TARGET_LEVEL', 1)
          }
        } else if (value === Characteristic.LockTargetState.SECURED) {
          self.debugLog('lock command received send state 1 to ccu')
          self.setValue('LOCK_TARGET_LEVEL', 0)
        }

        callback()
      })



    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('LOCK_STATE'), (newValue) => {
      if (self.lockEvents === true) {
        self.debugLog('event for LOCK_STATE with value %s but events are locked due to recent homekit command', newValue)
        return
      }
      let lcs
      let lts
      switch (parseInt(newValue)) {
        case 0:
          lcs = Characteristic.LockCurrentState.UNSECURED
          lts = Characteristic.LockTargetState.UNSECURED
          break
        case 1:
          lcs = Characteristic.LockCurrentState.SECURED
          lts = Characteristic.LockTargetState.SECURED
          break
        case 2:
          lcs = Characteristic.LockCurrentState.UNSECURED
          lts = Characteristic.LockTargetState.UNSECURED
          break
      }

      self.debugLog('event for LOCK_STATE with value %s will update lockCurrentState (%s) lockTargetState (%s)', newValue, lcs, lts)
      self.updateCharacteristic(self.lockCurrentState, lcs)
      self.updateCharacteristic(self.lockTargetState, lts)
    })

    // Optional Open Switch
    if (addDoorOpener === true) {
      const openerService = self.addService(new Service.Switch(`${self._name} - Opener`, 'Opener'))
      let opchar = openerService.getCharacteristic(Characteristic.On)
      opchar.on('get', (callback) => {
        if (callback) {
          callback(null, 0)
        }
      })

      opchar.on('set', (value, callback) => {
        if (self.isTrue(value)) {
          self.setValue('LOCK_TARGET_LEVEL', 2).then(() => { })
          self.openTimer = setTimeout(() => {
            self.debugLog('reset Opener Switch')
            self.updateCharacteristic(opchar, 0)
            setTimeout(() => {
              self.queryState()
            }, 10000)
          }, 2000)
        }
        callback()
      })
    }

    this.registerAddressForEventProcessingAtAccessory(this.buildAddress('ACTIVITY_STATE'), (newValue) => {
      let as = parseInt(newValue);
      if (as === 3) {
        self.lockEvents = false
        self.queryState();
      }
    })

  }


  queryState() {
    this.getValue('LOCK_STATE', true) // should trigger the registered events
  }

  shutdown() {
    clearTimeout(this.openTimer)
    clearTimeout(this.requeryTimer)
    super.shutdown()
  }

  static channelTypes() {
    return ['DOOR_LOCK_STATE_TRANSMITTER']
  }

  static getPriority() {
    return 2
  }

  static serviceDescription() {
    return 'This service provides a locking system in HomeKit connected to your Keymatic'
  }

  static configurationItems() {
    return {
      'unlockMode': {
        type: 'option',
        array: ['unlock', 'open'],
        default: 'unlock',
        label: 'Unlock mode',
        hint: 'What to do when HomeKit will unlock the door'
      },
      'addDoorOpener': {
        type: 'checkbox',
        default: false,
        label: 'Add a door opener switch',
        hint: ''
      }
    }
  }
}
