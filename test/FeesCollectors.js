const { assert } = require('chai');

require('chai')
  .use(require('chai-as-promised'))
  .should();

// eslint-disable-next-line no-undef
const FeesCollectors = artifacts.require('FeesCollectors');

// eslint-disable-next-line no-undef
contract('FeesCollectors', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};

  const [deployer, alice, bob] = accounts;

  let feesCollector;

  beforeEach(async () => {
    feesCollector = await FeesCollectors.new().should.be.fulfilled;
  });

  it('deploys with expected storage', async () => {
    assert.equal(await feesCollector.defaultFeesCollector(), accounts[0]);
    const past = await feesCollector.getPastEvents('DefaultFeesCollector', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.feesCollector, deployer);
  });

  it('set default fees collector', async () => {
    assert.notEqual(bob, deployer);
    assert.equal(await feesCollector.defaultFeesCollector(), deployer);
    await feesCollector.setDefaultFeesCollector(bob, { from: alice }).should.be.rejected;
    await feesCollector.setDefaultFeesCollector(bob, { from: deployer }).should.be.fulfilled;
    assert.equal(await feesCollector.defaultFeesCollector(), bob);
    assert.equal(await feesCollector.universeFeesCollector(1), bob);

    // check events:
    const past = await feesCollector.getPastEvents('DefaultFeesCollector', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.feesCollector, deployer);
    assert.equal(past[1].args.feesCollector, bob);
  });

  it('Add and remove universe fees collector', async () => {
    // The default feesCollector is used unless there exists
    // and explicit universeFeesCollector for a given universe
    assert.equal(await feesCollector.defaultFeesCollector(), deployer);
    const uni = 0;
    await feesCollector.setUniverseFeesCollector(uni, bob, { from: alice }).should.be.rejected;
    await feesCollector.setUniverseFeesCollector(uni, bob, { from: deployer }).should.be.fulfilled;
    assert.equal(await feesCollector.universeFeesCollector(uni), bob);
    await feesCollector.removeUniverseFeesCollector(uni, { from: alice }).should.be.rejected;
    await feesCollector.removeUniverseFeesCollector(uni, { from: deployer }).should.be.fulfilled;
    assert.equal(await feesCollector.universeFeesCollector(uni), deployer);

    // check events
    const past = await feesCollector.getPastEvents('UniverseFeesCollector', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.universeId, uni);
    assert.equal(past[1].args.universeId, uni);
    assert.equal(past[0].args.feesCollector, bob);
    assert.equal(past[1].args.feesCollector, deployer);
  });
});
