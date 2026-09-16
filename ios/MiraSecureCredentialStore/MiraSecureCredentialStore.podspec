Pod::Spec.new do |s|
  s.name = 'MiraSecureCredentialStore'
  s.version = '1.0.0'
  s.summary = 'Private Keychain-backed credential bridge for Mira Mobile.'
  s.homepage = 'https://github.com/uichat-mira/mira-mobile'
  s.license = { :type => 'MIT' }
  s.author = { 'Mira Mobile' => 'mobile@local.invalid' }
  s.source = { :path => '.' }
  s.platform = :ios, '15.1'
  s.source_files = 'MiraSecureCredentialStore.mm'
  s.frameworks = 'Security'
  s.dependency 'React-Core'
end
