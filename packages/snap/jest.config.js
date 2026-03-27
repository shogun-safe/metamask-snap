/** Jest configuration for the Snap package (ts-jest + @metamask/snaps-jest preset). */
module.exports = {
  preset: '@metamask/snaps-jest',
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
};
