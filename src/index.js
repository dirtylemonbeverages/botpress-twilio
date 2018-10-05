const twilio = require('twilio');
const qs = require('querystring');
const _ = require('lodash');
const bodyParser = require('body-parser');

const { extractNumber } = require('./util');
const UMM = require('./umm');

let client = null

module.exports = {

  config: {
    accountSID: { type: 'string', required: true, env: 'TWILIO_SID' },
    authToken: { type: 'string', required: true, env: 'TWILIO_TOKEN' },
    fromNumber: { type: 'string', required: false, env: 'TWILIO_FROM' },
    messagingServiceSid: { type: 'string', required: false, env: 'TWILIO_MESSAGING_SERVICE_SID' }
  },

  init: async function(bp, configurator) {
    bp.middlewares.register({
      name: 'twilio.sendSms',
      type: 'outgoing',
      order: 100,
      handler: handleOutgoing,
      module: 'botpress-twilio',
      description: 'Sends out text messages by SMS using Twilio'
    })

    const {
      accountSID,
      authToken,
      fromNumber,
      messagingServiceSid
    } = await configurator.loadAll()

    client = new twilio(accountSID, authToken)

    function handleOutgoing(event, next) {
      if (event.platform !== 'twilio') {
        // Only process twilio messages
        return next()
      }

      const payload = {
        to: extractNumber(event),
        body: event.text
      }

      if (!_.isNil(messagingServiceSid)) {
        payload.messagingServiceSid = messagingServiceSid
      } else {
        payload.from = fromNumber
      }

      client.messages.create(payload)
      .then(() => {
        if (event._promise && event._resolve) {
          event._resolve()
        }
      })
    }

    UMM(bp)
  },

  ready: async function(bp, configurator) {

    function logDebug(message) {
      if (process.env.TWILIO_DEBUG) {
        bp.logger.debug('[Twilio] ' + message)
      }
    }

    async function getOrCreateUser(fromNumber) {
      const id = `twilio:${fromNumber}`;
      const existingUser = await bp.db.get()
        .then(knex => knex('users').where('id', id))
        .then(users => users[0]);

      if (existingUser) {
        existingUser.id = fromNumber;
        return existingUser;

      } else {
        const newUser = {
          first_name: 'Unknown',
          last_name: 'Unknown',
          profile_pic: null,
          id: fromNumber,
          platform: 'twilio',
          number: fromNumber
        }

        await bp.db.saveUser(newUser);
        return newUser;
      }
    }

    bp.twilio = { getOrCreateUser }

    const router = bp.getRouter('botpress-twilio', {
      'bodyParser.json': false,
      'auth': false,
      'bodyParser.urlencoded': false
    })

    router.use(bodyParser.urlencoded({
      extended: false
    }))

    const { authToken } = await configurator.loadAll()

    router.post('/webhook', async (req, res) => {
      logDebug(`Incoming Twilio Message [HOST='${req.headers.host}'] [URL='${req.originalUrl}']`)

      const valid = twilio.validateExpressRequest(req, authToken, { protocol: 'https' })
      
      if (!valid) {
        logDebug('Signature verification failed')
        return res.sendStatus(403)
      }

      logDebug('Message verified')
      const twiml = new twilio.twiml.MessagingResponse();
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml.toString()); // Reply with nothing

      const {
        Body: message,
        From: fromNumber,
        FromCountry: fromCountry,
        FromCity: fromCity,
        FromState: fromState,
        SmsSid: smsSid,
        SmsMessageSid: messageSid,
        To: _toNumber,
        AccountSid: _accountSid,
        NumMedia: numMedia
      } = req.body || {}

      const user = await getOrCreateUser(fromNumber)

      let media
      if (parseInt(numMedia, 10) > 0) {
        media = Array(parseInt(numMedia, 10)).fill('').map((_, i) => {
          return {
            contentType: req.body[`MediaContentType${i}`],
            url: req.body[`MediaUrl${i}`]
          }
        })
      }

      bp.middlewares.sendIncoming({
        platform: 'twilio',
        type: 'message',
        user: user,
        text: message,
        media: media,
        raw: { message, media, fromNumber, fromCountry, fromCity, fromState, smsSid, messageSid }
      })

      logDebug('Message delivered to bot')
    })
  }
}
