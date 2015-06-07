var OP_CODES = [
  new Buffer([0x00]), // wild-card to be defined
  new Buffer([0x01]), // All Hashes in OP_RETURN - Pay-to-PubkeyHash
  new Buffer([0x02]), // SHA2 in Pay-to-Script-Hash multi-sig output (1 out of 2)
  new Buffer([0x03]), // All Hashes in Pay-to-Script-Hash multi-sig outputs (1 out of 3)
  new Buffer([0x04]), // Low security issue no SHA2 for torrent data. SHA1 is always inside OP_RETURN in this case.
  new Buffer([0x05]), // No rules, no torrent, no meta data ( no one may add rules in the future, anyone can add metadata )
  new Buffer([0x06])  // No meta data (anyone can add rules and/or metadata  in the future)
]

var sffc = require('sffc-encoder')
var issueFlagsCodex = require(__dirname + '/issueFlagsEncoder')
var paymentCodex = require('cc-payment-encoder')

var consumer = function (buff) {
  var curr = 0
  return function consume (len) {
    return buff.slice(curr, curr += len)
  }
}

module.exports = {
  encode: function (data, byteSize) {
    if (!data
      || typeof data.amountOfUnits === 'undefined'
      || typeof data.lockStatus === 'undefined'
      || typeof data.divisibility === 'undefined'
      || typeof data.protocol === 'undefined'
      || typeof data.version === 'undefined'
      ) {
      throw new Error('Missing Data')
    }
    var opcode
    var hash = new Buffer(0)
    var protocol = new Buffer(data.protocol.toString(16), 'hex')
    var version = new Buffer(data.version.toString(16), 'hex')
    var issueHeader = Buffer.concat([protocol, version])
    var amountOfUnits = sffc.encode(data.amountOfUnits)
    var payments = new Buffer(0)
    if (data.payments) payments = paymentCodex.encodeBulk(data.payments)
    var issueTail = Buffer.concat([amountOfUnits, payments, issueFlagsCodex.encode(data.divisibility, data.lockStatus)])
    var issueByteSize = issueHeader.length + issueTail.length + 1

    if (issueByteSize > byteSize) throw new Error('Data code is bigger then the allowed byte size')
    if (!data.sha2) {
      if (data.torrentHash) {
        if (issueByteSize + data.torrentHash.length > byteSize) throw new Error('Can\'t fit Torrent Hash in byte size')
        return {codeBuffer: Buffer.concat([issueHeader, OP_CODES[4], data.torrentHash, issueTail]), leftover: []}
      }
      opcode = data.allowMeta ? OP_CODES[6] : OP_CODES[5]
      return {codeBuffer: Buffer.concat([issueHeader, opcode, hash, issueTail]), leftover: []}
    }
    if (!data.torrentHash) throw new Error('Torrent Hash is missing')
    var leftover = [data.torrentHash, data.sha2]

    opcode = OP_CODES[3]
    issueByteSize = issueByteSize + data.torrentHash.length

    if (issueByteSize <= byteSize) {
      hash = Buffer.concat([hash, leftover.shift()])
      opcode = OP_CODES[2]
      issueByteSize = issueByteSize + data.sha2.length
    }
    if (issueByteSize <= byteSize) {
      hash = Buffer.concat([hash, leftover.shift()])
      opcode = OP_CODES[1]
    }

    return {codeBuffer: Buffer.concat([issueHeader, opcode, hash, issueTail]), leftover: leftover}
  },

  decode: function (op_code_buffer) {
    var data = {}
    if (!Buffer.isBuffer(op_code_buffer)) {
      op_code_buffer = new Buffer(op_code_buffer, 'hex')
    }
    var byteSize = op_code_buffer.length
    var lastByte = op_code_buffer.slice(-1)
    var issueTail = issueFlagsCodex.decode(consumer(lastByte))
    data.divisibility = issueTail.divisibility
    data.lockStatus = issueTail.lockStatus
    var consume = consumer(op_code_buffer.slice(0, byteSize - 1))
    data.protocol = consume(2).toString('hex')
    data.version = consume(1).toString('hex')
    var opcode = consume(1)
    if (opcode.equals(OP_CODES[1])) {
      data.torrentHash = consume(20)
      data.sha2 = consume(32)
    } else if (opcode.equals(OP_CODES[2])) {
      data.torrentHash = consume(20)
    } else if (opcode.equals(OP_CODES[3])) {
    } else if (opcode.equals(OP_CODES[4])) {
    } else if (opcode.equals(OP_CODES[5])) {
      data.allowMeta = false
    } else if (opcode.equals(OP_CODES[6])) {
      data.allowMeta = true
    } else {
      throw new Error('Unrecognized Code')
    }

    data.amountOfUnits = sffc.decode(consume)
    data.payments = paymentCodex.decodeBulk(consume)

    return data
  }
}