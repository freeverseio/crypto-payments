const { assert } = require('chai');

require('chai')
  .use(require('chai-as-promised'))
  .should();

// eslint-disable-next-line no-undef
const Operators = artifacts.require('Operators');

// eslint-disable-next-line no-undef
contract('Operators', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};

  const [deployer, alice, bob] = accounts;

  let operator;

  beforeEach(async () => {
    operator = await Operators.new().should.be.fulfilled;
  });

  it('deploys with expected storage and event', async () => {
    assert.equal(await operator.defaultOperator(), deployer);
    const past = await operator.getPastEvents('DefaultOperator', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.operator, deployer);
  });

  it('set default operator', async () => {
    assert.notEqual(bob, deployer);
    assert.equal(await operator.defaultOperator(), deployer);
    await operator.setDefaultOperator(bob, { from: alice }).should.be.rejected;
    await operator.setDefaultOperator(bob, { from: deployer }).should.be.fulfilled;
    assert.equal(await operator.defaultOperator(), bob);
    assert.equal(await operator.universeOperator(1), bob);

    // check events:
    const past = await operator.getPastEvents('DefaultOperator', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.operator, deployer);
    assert.equal(past[1].args.operator, bob);
  });

  it('Add and remove universe operators', async () => {
    // The default operator is used unless there exists
    // and explicit universeOperator for a given universe
    assert.equal(await operator.defaultOperator(), deployer);
    const uni = 0;
    await operator.setUniverseOperator(uni, bob, { from: alice }).should.be.rejected;
    await operator.setUniverseOperator(uni, bob, { from: deployer }).should.be.fulfilled;
    assert.equal(await operator.universeOperator(uni), bob);
    await operator.removeUniverseOperator(uni, { from: alice }).should.be.rejected;
    await operator.removeUniverseOperator(uni, { from: deployer }).should.be.fulfilled;
    assert.equal(await operator.universeOperator(uni), deployer);

    // check events
    const past = await operator.getPastEvents('UniverseOperator', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.universeId, uni);
    assert.equal(past[1].args.universeId, uni);
    assert.equal(past[0].args.operator, bob);
    assert.equal(past[1].args.operator, deployer);
  });
});
