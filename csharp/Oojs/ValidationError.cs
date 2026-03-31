namespace Oojs;

public sealed record ValidationError(string Path, string Code, string Message)
{
    public override string ToString() => $"{Path}: [{Code}] {Message}";
}
