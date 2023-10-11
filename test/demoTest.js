const { expect } = require("chai");
const { ethers, deployments, getNamedAccounts } = require("hardhat");
const namehash = require("@ensdomains/eth-ens-namehash");
const { utils } = ethers;

const label = "eth";
const labelHash = utils.keccak256(utils.toUtf8Bytes(label));
const node = namehash.hash(label);
const ROOT_NODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function increaseTime(secs) {
  return ethers.provider.send("evm_increaseTime", [secs]);
}

/**
 * @description executes the delegation transfer process for multiple source and target delegates.
 * @param _sourceAmounts the list of source delegates and their amounts, in the format [[address, amount], ...].
 * @param _targetAmounts the list of target delegates and their amounts, in the same format.
 * @returns the source addresses, the target addresses, and the transferred amounts.
 */
function reDistributeVotingPower(_sourceAmounts, _targetAmounts) {
  // deep copy of the input arrays to keep them immutable
  let sourceAmounts = [..._sourceAmounts.map((source) => [...source])];
  let targetAmounts = [..._targetAmounts.map((target) => [...target])];

  let fromAddresses = [];
  let toAddresses = [];
  let amounts = [];

  let sourceIndex = 0;
  let targetIndex = 0;

  // loop until we've gone through either all sources or all targets
  while (
    sourceIndex < sourceAmounts.length &&
    targetIndex < targetAmounts.length
  ) {
    let source = sourceAmounts[sourceIndex];
    let target = targetAmounts[targetIndex];

    // calculate the amount to transfer (the minimum of the source's and target's amounts)
    let transfer = ethers.BigNumber.from(source[1]).lt(target[1])
      ? source[1]
      : target[1];

    fromAddresses.push(source[0]);
    toAddresses.push(target[0]);
    amounts.push(transfer);

    // subtract the transferred amount from the source's and target's amounts
    source[1] = ethers.BigNumber.from(source[1]).sub(transfer);
    target[1] = ethers.BigNumber.from(target[1]).sub(transfer);

    // if the source's amount is now 0, move to the next source
    if (ethers.BigNumber.from(source[1]).isZero()) {
      sourceIndex += 1;
    }

    // if the target's amount is now 0, move to the next target
    if (ethers.BigNumber.from(target[1]).isZero()) {
      targetIndex += 1;
    }
  }

  // if there are remaining sources after going through all targets, add them to the output arrays
  while (sourceIndex < sourceAmounts.length) {
    fromAddresses.push(sourceAmounts[sourceIndex][0]);
    amounts.push(sourceAmounts[sourceIndex][1]);
    sourceIndex += 1;
  }

  // if there are remaining targets after going through all sources, add them to the output arrays
  while (targetIndex < targetAmounts.length) {
    toAddresses.push(targetAmounts[targetIndex][0]);
    amounts.push(targetAmounts[targetIndex][1]);
    targetIndex += 1;
  }

  return [fromAddresses, toAddresses, amounts];
}

describe("ENS Multi Delegate", () => {
  let token;
  let deployer;
  let alice;
  let bob;
  let charlie;
  let dave;
  let resolver;
  let registry;
  let snapshot;
  let multiDelegate;

  before(async () => {
    ({ deployer, alice, bob, charlie, dave } = await getNamedAccounts());
  });

  beforeEach(async () => {
    snapshot = await ethers.provider.send("evm_snapshot", []);

    await deployments.fixture(["ENSToken"]);
    token = await ethers.getContract("ENSToken");

    const Registry = await ethers.getContractFactory("ENSRegistry");
    registry = await Registry.deploy();
    await registry.deployed();

    const Resolver = await ethers.getContractFactory("PublicResolver");
    resolver = await Resolver.deploy(
      registry.address,
      ethers.constants.AddressZero
    );
    await resolver.deployed();

    const ENSMultiDelegate = await ethers.getContractFactory(
      "ERC20MultiDelegate"
    );
    multiDelegate = await ENSMultiDelegate.deploy(
      token.address,
      "http://localhost:8080/{id}"
    );
    await multiDelegate.deployed();

    await registry.setSubnodeOwner(ROOT_NODE, labelHash, deployer);
    await registry.setResolver(node, resolver.address);

    await increaseTime(365 * 24 * 60 * 60);
    const mintAmount = 1000000; // (await token.totalSupply()).div(50);
    await token.mint(deployer, mintAmount);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshot]);
  });

  describe("deposit", () => {
    it("should be able to delegate to already delegated delegates", async () => {
      const firstDelegatorBalance = await token.balanceOf(deployer);
      console.log(
        "firstDelegatorBalance",
        ethers.utils.formatEther(firstDelegatorBalance)
      );

      //deploy proxy
      const FakeDeployer = await ethers.getContractFactory("fakeDeployer");
      const fakeDeployerInstance = await FakeDeployer.deploy();
      console.log("fakeDeployer address", fakeDeployerInstance.address);

      await fakeDeployerInstance.fakeDeploy(token.address, alice);
      const fakeProxyFromFakeDeployer = await fakeDeployerInstance.fake();
      console.log(
        "fakeProxyFromFakeDeployer address",
        fakeProxyFromFakeDeployer
      );

      // Give allowance to multiDelegate contract
      await token.approve(multiDelegate.address, firstDelegatorBalance);

      const delegates = [alice];
      const amounts = delegates.map(() =>
        ethers.utils.formatUnits(firstDelegatorBalance, "wei")
      );

      await multiDelegate.delegateMulti([], delegates, amounts);

      await token
        .connect(await ethers.provider.getSigner(alice))
        .approve(
          multiDelegate.address,
          ethers.utils.formatUnits(firstDelegatorBalance, "wei")
        );

      const gasEst = await multiDelegate.estimateGas.delegateMulti(
        [alice],
        [deployer],
        amounts
      );
      console.log("gas est", ethers.utils.formatUnits(gasEst, 'wei'));

      await multiDelegate.delegateMulti([alice], [charlie], amounts);
     // await multiDelegate.delegateMulti([deployer], [], amounts);

      const aliceProxy = await multiDelegate.retrieveProxyContractAddress(
        token.address,
        alice
      );
      console.log("alice proxy deployed by multidelegate", aliceProxy);

      // Bal of alice proxy
      const balOfProxyOfAlice = await multiDelegate.getBalanceForDelegate(
        aliceProxy
      );

      console.log(
        "getBalanceForDelegateOfProxyOfAlice",
        ethers.utils.formatEther(balOfProxyOfAlice)
      );

      const tokenBalOfAliceProxy = await token.balanceOf(aliceProxy);
      console.log(
        "erc20votestokenBalOfAliceProxy",
        ethers.utils.formatEther(tokenBalOfAliceProxy)
      );

      

      //bal for alice herslf
      const balOfAlice = await multiDelegate.getBalanceForDelegate(alice);
      console.log(
        "getBalanceForDelegateOfAlice",
        ethers.utils.formatEther(balOfAlice)
      );

      const tokenBalOfAlice = await token.balanceOf(alice);
      console.log(
        "erc20votestokenBalOfAlice",
        ethers.utils.formatEther(tokenBalOfAlice)
      );

      //for bob
      const bobProxy = await multiDelegate.retrieveProxyContractAddress(
        token.address,
        bob
      );

      // Bal of bob proxy
      const balOfProxyOfBob = await multiDelegate.getBalanceForDelegate(
        bobProxy
      );
      console.log(
        "getBalanceForDelegateOfProxyOfBob",
        ethers.utils.formatEther(balOfProxyOfBob)
      );

      const tokenBalOfBobProxy = await token.balanceOf(bobProxy);
      console.log(
        "erc20votestokenBalOfBobProxy",
        ethers.utils.formatEther(tokenBalOfBobProxy)
      );

      //bal for Bob herslf
      const balOfBob = await multiDelegate.getBalanceForDelegate(bob);
      console.log(
        "getBalanceForDelegateOfBob",
        ethers.utils.formatEther(balOfBob)
      );

      const tokenBalOfBob = await token.balanceOf(bob);
      console.log(
        "erc20votestokenBalOfBob",
        ethers.utils.formatEther(tokenBalOfBob)
      );

      //for charlie
      const charlieProxy = await multiDelegate.retrieveProxyContractAddress(
        token.address,
        charlie
      );

      // Bal of charlie proxy
      const balOfProxyOfCharlie = await multiDelegate.getBalanceForDelegate(
        charlieProxy
      );
      console.log(
        "getBalanceForDelegateOfProxyOfCharlie",
        ethers.utils.formatEther(balOfProxyOfCharlie)
      );

      const tokenBalOfCharlieProxy = await token.balanceOf(charlieProxy);
      console.log(
        "erc20votestokenBalOfCharlieProxy",
        ethers.utils.formatEther(tokenBalOfCharlieProxy)
      );

      const charlieVotes = await token.getVotes(charlie);
      console.log(
        "charlieVotes",
        ethers.utils.formatEther(charlieVotes)
      );

      //bal for chaRLIE herslf
      const balOfCharlie = await multiDelegate.getBalanceForDelegate(charlie);
      console.log(
        "getBalanceForDelegateOfCharlie",
        ethers.utils.formatEther(balOfCharlie)
      );

      const tokenBalOfCharlie = await token.balanceOf(charlie);
      console.log(
        "erc20votestokenBalOfCharlie",
        ethers.utils.formatEther(tokenBalOfCharlie)
      );

      //delegator bal after
      const firstDelegatorBalanceAfter = await token.balanceOf(deployer);
      console.log(
        "firstDelegatorBalance",
        ethers.utils.formatEther(firstDelegatorBalanceAfter)
      );

      console.log(
        "difference ",
        ethers.utils.formatEther(
          firstDelegatorBalance.sub(firstDelegatorBalanceAfter)
        )
      );
      console.log("address of votes token", token.address);
      console.log("address of multidelegate", multiDelegate.address);
    });
  });
});
