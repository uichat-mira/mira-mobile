const mockRegisterComponent = jest.fn();

jest.mock('react-native', () => ({
  AppRegistry: {
    registerComponent: mockRegisterComponent,
  },
}));

jest.mock('../src/settings/generalSettings', () => ({
  applyStartupTextScale: jest.fn(() => new Promise(() => {})),
}));

describe('startup registration', () => {
  it('registers the app before async startup settings settle', () => {
    require('../index');

    expect(mockRegisterComponent).toHaveBeenCalledTimes(1);
    expect(mockRegisterComponent).toHaveBeenCalledWith(
      'uichat-mira-mobile',
      expect.any(Function),
    );
  });
});
