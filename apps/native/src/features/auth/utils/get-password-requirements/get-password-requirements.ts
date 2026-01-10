export interface PasswordRequirement {
  text: string;
  met: boolean;
}

export const getPasswordRequirements = (
  password: string,
): PasswordRequirement[] => {
  return [
    {
      text: "At least 8 characters",
      met: password.length >= 8,
    },
    {
      text: "One uppercase letter",
      met: /[A-Z]/.test(password),
    },
    {
      text: "One number",
      met: /\d/.test(password),
    },
    {
      text: "One special character",
      met: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    },
  ];
};
