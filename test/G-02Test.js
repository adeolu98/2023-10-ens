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
  let optimizedMultiDelegate;

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
    const OptimizedERC20MultiDelegate = await ethers.getContractFactory(
      "OptimizedERC20MultiDelegate"
    );

    multiDelegate = await ENSMultiDelegate.deploy(
      token.address,
      "http://localhost:8080/{id}"
    );

    optimizedMultiDelegate =  await OptimizedERC20MultiDelegate.deploy(
      token.address,
      "http://localhost:8080/{id}"
    );


    await multiDelegate.deployed();
    await optimizedMultiDelegate.deployed();

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
    it("compare gas cost", async () => {
      const firstDelegatorBalance = await token.balanceOf(deployer);
      const tokenAmount = firstDelegatorBalance.div("5")


      // Give allowance to multiDelegate contracts
      await token.approve(multiDelegate.address, tokenAmount);
      await token.approve(optimizedMultiDelegate.address, tokenAmount);

      const delegates = [alice];
      const amounts = delegates.map(() =>
        ethers.utils.formatUnits(tokenAmount, "wei")
      );

      await multiDelegate.delegateMulti([], delegates, amounts);
      await optimizedMultiDelegate.delegateMulti([], delegates, amounts);

      await token
        .connect(await ethers.provider.getSigner(alice))
        .approve(
          multiDelegate.address,
          ethers.utils.formatUnits(firstDelegatorBalance, "wei")
        );

      await token
        .connect(await ethers.provider.getSigner(alice))
        .approve(
          optimizedMultiDelegate.address,
          ethers.utils.formatUnits(firstDelegatorBalance, "wei")
        );

      const gasEstNotOptimized = await multiDelegate.estimateGas.delegateMulti(
        [alice],
        [deployer],
        amounts
      );

      const gasEstOptimized = await optimizedMultiDelegate.estimateGas.delegateMulti(
        [alice],
        [deployer],
        amounts
      );

      console.log("gas cost for calling not optimized func in contract", ethers.utils.formatUnits(gasEstNotOptimized, 'wei'));
      console.log("gas cost for calling optimized func in  contract", ethers.utils.formatUnits(gasEstOptimized, 'wei'));

      console.log('difference in gas cost between not optimized and optimized funcs', ethers.utils.formatUnits(gasEstNotOptimized.sub(gasEstOptimized), 'wei') )
      
    });
  });
});