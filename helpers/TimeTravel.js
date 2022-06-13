// Class that allows the local blockchain on which tests are run
// to advance time, revert to snapshot, etc.
class TimeTravel {
  constructor(web3) {
    this.web3 = web3;
  }

  advanceTime(time) {
    return new Promise((resolve, reject) => {
      this.web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [time],
        id: new Date().getTime(),
      }, (err, result) => {
        if (err) { return reject(err); }
        return resolve(result);
      });
    });
  }

  advanceBlock() {
    return new Promise((resolve, reject) => {
      this.web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: new Date().getTime(),
      }, (err) => {
        if (err) { return reject(err); }
        const newBlockHash = this.web3.eth.getBlock('latest').hash;

        return resolve(newBlockHash);
      });
    });
  }

  async getNow() {
    const block = await this.web3.eth.getBlock('latest');
    return block.timestamp;
  }

  takeSnapshot() {
    return new Promise((resolve, reject) => {
      this.web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_snapshot',
        id: new Date().getTime(),
      }, (err, snapshotId) => {
        if (err) { return reject(err); }
        return resolve(snapshotId);
      });
    });
  }

  revertToSnapShot(id) {
    return new Promise((resolve, reject) => {
      this.web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_revert',
        params: [id],
        id: new Date().getTime(),
      }, (err, result) => {
        if (err) { return reject(err); }
        return resolve(result);
      });
    });
  }

  async wait(secs) {
    await this.advanceTime(secs);
    await this.advanceBlock();
    return Promise.resolve(this.web3.eth.getBlock('latest'));
  }

  async waitUntil(targetTime) {
    const currentTime = await this.getNow();
    await this.wait(targetTime - currentTime);
  }

  async advanceNBlocks(nBlocks) {
    for (let n = 0; n < nBlocks; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.advanceBlock();
    }
  }
}

module.exports = {
  TimeTravel,
};
