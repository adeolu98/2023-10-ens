module.exports = async ({getNamedAccounts, deployments}) => {
  const {deploy} = deployments;
  const {deployer} = await getNamedAccounts();
  const ensToken = await ethers.getContract('ENSToken');
  const timelockController = await ethers.getContract('TimelockController');
  await deploy('ENSGovernor', {
    from: deployer,
    args: [ensToken.address, timelockController.address],
    log: true,
  });
  const governor = await ethers.getContract('ENSGovernor');
  await (await timelockController.grantRole(await timelockController.PROPOSER_ROLE(), governor.address)).wait();
  await (await timelockController.revokeRole(await timelockController.TIMELOCK_ADMIN_ROLE(), deployer)).wait();
  return true;
};
module.exports.tags = ['ENSGovernor'];
module.exports.dependencies = ['ENSToken', 'TimelockController'];
module.exports.id = 'ENSGovernor';
