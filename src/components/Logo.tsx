type Props = {
  variant?: "red" | "white";
  height?: number;
  className?: string;
};

const Logo = ({ variant = "red", height = 40, className = "" }: Props) => (
  <img
    src={variant === "white" ? "/logo-white.png" : "/logo-red.png"}
    alt="Longhorn Associates"
    height={height}
    className={`official-logo ${className}`}
    style={{ height, width: "auto" }}
  />
);

export default Logo;
