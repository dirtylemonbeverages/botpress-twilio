const util = require('util');
const _ = require('lodash');
const Promise = require('bluebird');

const { extractNumber } = require('./util');

function PromisifyEvent(event) {
  if (!event._promise) {
    event._promise = new Promise((resolve, reject) => {
      event._resolve = resolve
      event._reject = reject
    })
  }

  return event
}

function processOutgoing({ event, blocName, instruction }) {
  const ins = Object.assign({}, instruction) // Create a shallow copy of the instruction

  ////////
  // PRE-PROCESSING
  ////////
  
  const optionsList = ['typing']

  const options = _.pick(instruction, optionsList)
  
  for (let prop of optionsList) {
    delete ins[prop]
  }

  /////////
  /// Processing
  /////////

  if (!_.isNil(instruction.text)) {
    const number = extractNumber(event)
    
    return PromisifyEvent({
      platform: 'twilio',
      type: 'text',
      user: { id: number, number },
      raw: Object.assign({ to: number, message: instruction.text }, options),
      text: instruction.text
    })
  }

  ////////////
  /// POST-PROCESSING
  ////////////
  
  // Nothing to post-process yet

  ////////////
  /// INVALID INSTRUCTION
  ////////////

  const strRep = util.inspect(instruction, false, 1)
  throw new Error(`Unrecognized instruction in Twilio in bloc '${blocName}': ${strRep}`)
}

module.exports = bp => {
  const [umm, registerConnector] = _.at(bp, ['umm', 'umm.registerConnector'])

  umm && registerConnector && registerConnector({
    platform: 'twilio',
    processOutgoing: args => processOutgoing(Object.assign({}, args, { bp })),
    templates: []
  })
}
